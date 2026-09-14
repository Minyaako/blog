import type { Friend } from '../config/friends'

export const FEED_MAX_BYTES = 2 * 1024 * 1024
export const FEED_MAX_SOURCES = 12
export const FEED_TIMEOUT_MS = 5000

export interface FriendFeed {
  name: string
  site: string
  status: 'ready' | 'unavailable'
  xml?: string
}

export function publicHttpsUrl(value: string, base?: string): string | null {
  try {
    if (/[\u0000-\u0020\\]/u.test(value)) return null
    const url = new URL(value, base)
    const host = url.hostname.toLowerCase().replace(/\.$/u, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !host.includes('.') || /[\[\]:]/u.test(host) || /^[\d.]+$/u.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host)) return null
    return url.href
  } catch { return null }
}

export async function collectFriendFeeds(config: Friend[], fetcher: typeof fetch = fetch): Promise<FriendFeed[]> {
  const sources = config.filter(friend => friend.feed).slice(0, FEED_MAX_SOURCES)
  return Promise.all(sources.map(async friend => {
    const fallback: FriendFeed = { name: friend.name, site: friend.url, status: 'unavailable' }
    const url = publicHttpsUrl(friend.feed!)
    if (!url || !publicHttpsUrl(friend.url)) return fallback
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS)
    try {
      const response = await fetcher(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml' }
      })
      if (!response.ok || !response.body) return fallback
      if (Number(response.headers.get('content-length')) > FEED_MAX_BYTES) {
        await response.body.cancel()
        return fallback
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let xml = ''
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > FEED_MAX_BYTES) {
            await reader.cancel()
            return fallback
          }
          xml += decoder.decode(value, { stream: true })
        }
      } finally { reader.releaseLock() }
      xml += decoder.decode()
      if (!xml.trim() || /<!DOCTYPE|<!ENTITY/iu.test(xml)) return fallback
      return { name: friend.name, site: friend.url, status: 'ready', xml }
    } catch { return fallback }
    finally { clearTimeout(timer); controller.abort() }
  }))
}
