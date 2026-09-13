import type { APIRoute } from 'astro'
import { SITE } from '../../config/site'
import { renderSitemap } from '../../lib/seo'
import { getRankingStore } from '../../server/ranking/runtime'

export const prerender = false
export const GET: APIRoute = () => {
  try {
    const entries = getRankingStore().listPublicReferences().map(({ rankingId, publishedAt }) => ({
      url: new URL(`/ranking/${rankingId}/`, SITE.origin).href, lastmod: publishedAt,
    }))
    return new Response(renderSitemap(entries), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch {
    return new Response('排行榜暂时不可用', { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
  }
}
