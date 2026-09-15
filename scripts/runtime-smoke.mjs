import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Runs inside the final image, with only the dependencies actually shipped.
const temporary = await mkdtemp(join(tmpdir(), 'blog-runtime-smoke-'))
let server
try {
  const database = join(temporary, 'ranking.sqlite')
  const backup = join(temporary, 'backup.sqlite')
  Object.assign(process.env, {
    ASTRO_NODE_AUTOSTART: 'disabled', RANKING_DATABASE: database,
    RANKING_WRITE_ENABLED: 'false', RANKING_ORIGIN: 'http://127.0.0.1',
  })
  const databaseCommand = (args, path = database) => execFileSync(process.execPath,
    ['--experimental-transform-types', 'scripts/ranking-db.ts', ...args],
    { env: { ...process.env, RANKING_DATABASE: path }, stdio: 'pipe', timeout: 15000 })
  databaseCommand(['init'])
  databaseCommand(['check'])
  databaseCommand(['backup', backup])
  databaseCommand(['check'], backup)

  const { handler } = await import(pathToFileURL(resolve('dist/server/entry.mjs')).href)
  const { createBlogHandler } = await import(pathToFileURL(resolve('scripts/blog-server.mjs')).href)
  server = createServer(createBlogHandler(handler))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const [path, status] of [
    ['/healthz', 200], ['/', 200], ['/about/', 200], ['/search/', 200],
    ['/pagefind/pagefind.js', 200], ['/ranking/', 200],
    ['/ranking/00000000-0000-4000-8000-000000000099/', 404],
    ['/api/ranking/ready/', 200], ['/api/ranking/auth/session/', 200],
    ['/api/ranking/submissions/', 401],
  ]) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, status, `Runtime route ${path}`)
    await response.arrayBuffer()
  }
  const image = await fetch(origin + '/_image/?href=%2Fcomments%2Femoji%2Ftw-emoji%2F263a.png&w=24&f=webp', { signal: AbortSignal.timeout(10000) })
  assert.equal(image.status, 200, 'Native Sharp image conversion')
  assert.match(image.headers.get('content-type') ?? '', /^image\/webp/)
  const bytes = Buffer.from(await image.arrayBuffer())
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP')
  assert.ok(bytes.length > 12)
  console.log('Runtime smoke passed: database init/check/backup, static routes, ranking SSR/API, native WebP conversion')
} finally {
  if (server) {
    server.closeAllConnections()
    await new Promise(done => server.close(done))
  }
  await rm(temporary, { recursive: true, force: true })
}
