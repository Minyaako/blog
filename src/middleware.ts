import { defineMiddleware } from 'astro:middleware'

// Keep database/session work off static blog routes.
export const onRequest = defineMiddleware(async ({ url, redirect }, next) => {
  if (url.pathname === '/sitemap-index.xml' || url.pathname === '/sitemap-0.xml') return redirect('/sitemap.xml', 308)
  const response = await next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (url.pathname.startsWith('/ranking/') || url.pathname.startsWith('/api/ranking/')) response.headers.set('Cache-Control', 'private, no-store')
  return response
})
