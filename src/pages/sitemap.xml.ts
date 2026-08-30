import type { APIContext } from 'astro'
import { SITE } from '../config/site'
import { getPublishedMoments } from '../lib/moments'
import { getPublishedPosts, toPostCard } from '../lib/posts'
import { rankings } from '../lib/ranking-fixtures'
import { buildSitemapEntries, renderSitemap } from '../lib/seo'

export async function GET(context: APIContext) {
  const [posts, moments] = await Promise.all([
    getPublishedPosts(),
    getPublishedMoments(),
  ])
  const entries = buildSitemapEntries({
    origin: context.site?.origin ?? SITE.origin,
    rankingIds: rankings.map((ranking) => ranking.id),
    posts: posts.map((post) => ({
      slug: toPostCard(post).slug,
      publishedAt: post.data.publishedAt,
      updatedAt: post.data.updatedAt,
      domain: post.data.domain,
      subcategory: post.data.subcategory,
      tagIds: post.data.tags,
      collections: post.data.collections,
    })),
    moments: moments.map((moment) => ({
      id: moment.id,
      publishedAt: moment.publishedAt,
      tagIds: moment.tags.map((tag) => tag.id),
    })),
  })

  return new Response(renderSitemap(entries), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
