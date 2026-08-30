import rss from '@astrojs/rss'
import type { APIContext } from 'astro'
import { SITE } from '../config/site'
import { getPublishedPosts, toFeedItem } from '../lib/posts'

export async function GET(context: APIContext) {
  const posts = await getPublishedPosts()
  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.origin,
    items: posts.map(toFeedItem),
    customData: `<language>${SITE.lang}</language>`
  })
}
