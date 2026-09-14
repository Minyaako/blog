import { friends } from '../../config/friends'
import { collectFriendFeeds } from '../../lib/friends-feeds'
import { parseFriendFeed, sortFriendArticles } from '../../lib/friends-feed-parser'
import { JSDOM } from 'jsdom'

export const prerender = true

export async function GET() {
  const raw = await collectFriendFeeds(friends)
  const dom = new JSDOM('')
  const parser = new dom.window.DOMParser()
  const feeds = raw.map(feed => {
    const parsed = parseFriendFeed(feed, parser)
    return { name: feed.name, available: parsed.available, articles: parsed.articles }
  })
  dom.window.close()
  const articles = sortFriendArticles(feeds.flatMap(feed => feed.articles))
  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), failed: feeds.filter(feed => !feed.available).length, articles }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
