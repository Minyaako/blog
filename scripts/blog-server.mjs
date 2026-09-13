import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/** Small transport boundary around Astro's standalone handler; no application state here. */
export function createBlogHandler(handler, options = {}) {
  const trustedProxies = new Set(options.trustedProxies ?? [])
  const writes = new Map()
  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    let url, pathname
    try {
      url = new URL(req.url || '/', 'http://localhost')
      pathname = decodeURI(url.pathname)
      if (/[\u0000-\u001f\u007f]/.test(pathname)) throw new Error('Invalid path')
    } catch { res.writeHead(400); res.end('Bad request'); return }
    const rankingApi = pathname === '/api/ranking' || pathname.startsWith('/api/ranking/')
    const dynamic = pathname === '/ranking' || pathname.startsWith('/ranking/') || rankingApi
    if (dynamic) res.setHeader('Cache-Control', 'private, no-store')
    else if (pathname.startsWith('/_astro/') || pathname.startsWith('/pagefind/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    if (pathname === '/healthz' || pathname === '/healthz/') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('ok'); return
    }
    if (pathname === '/sitemap-index.xml' || pathname === '/sitemap-0.xml') {
      res.writeHead(308, { Location: '/sitemap.xml' }); res.end(); return
    }
    if (rankingApi) {
      // Without this, the standalone static handler uses 301 even for POST.
      if (!pathname.endsWith('/')) {
        res.writeHead(308, { Location: `${url.pathname}/${url.search}` }); res.end(); return
      }
      if (req.method === 'POST') {
        let address = req.socket.remoteAddress || 'unknown'
        // A trusted gateway must overwrite X-Real-IP; never accept arbitrary forwarded chains.
        const forwarded = req.headers['x-real-ip']
        if (trustedProxies.has(address) && typeof forwarded === 'string' && isIP(forwarded)) address = forwarded
        const now = Date.now()
        for (const [key, bucket] of writes) if (bucket.until <= now) writes.delete(key)
        const bucket = writes.get(address) ?? { count: 0, until: now + 60_000 }
        if ((!writes.has(address) && writes.size >= 10_000) || ++bucket.count > 60) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
          res.end(JSON.stringify({ error: '请求过于频繁，请稍后再试' })); return
        }
        writes.set(address, bucket)
      }
    }
    return handler(req, res)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.env.ASTRO_NODE_AUTOSTART = 'disabled'
  const { handler } = await import('../dist/server/entry.mjs')
  const trustedProxies = (process.env.RANKING_TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean)
  if (trustedProxies.some(value => !isIP(value))) throw new Error('RANKING_TRUSTED_PROXY_IPS must contain exact IP addresses')
  const server = createServer(createBlogHandler(handler, { trustedProxies }))
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '0.0.0.0')
  process.once('SIGTERM', () => server.close())
  process.once('SIGINT', () => server.close())
}
