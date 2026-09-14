import { publicHttpsUrl, type FriendFeed } from './friends-feeds'

export interface FriendArticle { title: string; url: string; friend: string; date: string | null }
export interface ParsedFriendFeed { articles: FriendArticle[]; available: boolean }

function child(element: Element, name: string): Element | undefined {
  return Array.from(element.children).find(node => node.localName === name)
}

export function parseFriendFeed(feed: FriendFeed, parser: DOMParser): ParsedFriendFeed {
  if (feed.status !== 'ready' || !feed.xml || /<!DOCTYPE|<!ENTITY/iu.test(feed.xml)) return { articles: [], available: false }
  const document = parser.parseFromString(feed.xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) return { articles: [], available: false }
  const root = document.documentElement
  const atom = root.localName === 'feed'
  const channel = root.localName === 'rss' ? child(root, 'channel') : undefined
  if (!atom && !channel) return { articles: [], available: false }
  const entries = Array.from((atom ? root : channel!).children).filter(node => node.localName === (atom ? 'entry' : 'item')).slice(0, 100)
  const articles: FriendArticle[] = []
  for (const entry of entries) {
    const title = child(entry, 'title')?.textContent?.trim().slice(0, 240)
    const link = atom
      ? Array.from(entry.children).find(node => node.localName === 'link' && (!node.getAttribute('rel') || node.getAttribute('rel') === 'alternate'))?.getAttribute('href')
      : child(entry, 'link')?.textContent?.trim()
    const url = link ? publicHttpsUrl(link, feed.site) : null
    if (!title || !url) continue
    const rawDate = (child(entry, atom ? 'published' : 'pubDate') ?? child(entry, 'updated') ?? child(entry, 'date'))?.textContent
    const timestamp = rawDate ? Date.parse(rawDate) : NaN
    articles.push({ title, url, friend: feed.name, date: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null })
  }
  return { articles, available: true }
}

export function sortFriendArticles(articles: FriendArticle[]): FriendArticle[] {
  const seen = new Set<string>()
  return articles.sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))
    .filter(article => { if (seen.has(article.url)) return false; seen.add(article.url); return true }).slice(0, 30)
}
