import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'
import { createBlogHandler } from '../../scripts/blog-server.mjs'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})
async function serve() {
  const server = createServer(createBlogHandler((_req: unknown, res: import('node:http').ServerResponse) => { res.end('content') }))
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
it('preserves POST method on canonical API redirects and disables private caching', async () => {
  const origin = await serve()
  const response = await fetch(`${origin}/api/%72anking/submissions`, { method: 'POST', redirect: 'manual' })
  expect(response.status).toBe(308)
  expect(response.headers.get('location')).toBe('/api/%72anking/submissions/')
  expect(response.headers.get('cache-control')).toContain('no-store')
})
it('serves liveness without DB and preserves security and static resource headers', async () => {
  const origin = await serve()
  const health = await fetch(`${origin}/healthz`)
  expect(await health.text()).toBe('ok')
  const asset = await fetch(`${origin}/pagefind/pagefind.js`)
  expect(asset.headers.get('x-content-type-options')).toBe('nosniff')
  expect(asset.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  expect(asset.headers.get('cache-control')).toContain('immutable')
})
it('covers exact and encoded ranking roots without matching unrelated prefixes', async () => {
  const origin = await serve()
  for (const path of ['/ranking', '/%72anking', '/api/ranking', '/api/%72anking']) {
    const response = await fetch(`${origin}${path}`, { method: 'POST', redirect: 'manual' })
    expect(response.headers.get('cache-control')).toContain('no-store')
    if (path.startsWith('/api/')) {
      expect(response.status).toBe(308)
      expect(response.headers.get('location')).toBe(`${path}/`)
    }
    await response.text()
  }
  const unrelated = await fetch(`${origin}/ranking-other`)
  expect(unrelated.headers.get('cache-control')).toBeNull()
})
it('does not let untrusted forwarded headers bypass the request limiter', async () => {
  const origin = await serve()
  for (let i = 0; i < 60; i++) {
    const response = await fetch(`${origin}/api/${i % 2 ? '%72anking' : 'ranking'}/submissions/`, { method: 'POST', headers: { 'X-Real-IP': `192.0.2.${i}` } })
    expect(response.status).toBe(200)
    await response.text()
  }
  const response = await fetch(`${origin}/api/ranking/submissions/`, { method: 'POST', headers: { 'X-Real-IP': '198.51.100.1' } })
  expect(response.status).toBe(429)
})
it('rejects malformed path escapes instead of passing them to the router', async () => {
  const origin = await serve()
  expect((await fetch(`${origin}/api/%ZZ/submissions/`)).status).toBe(400)
})
