import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { collectFriendFeeds, FEED_MAX_BYTES, FEED_TIMEOUT_MS, publicHttpsUrl, type FriendFeed } from '../../src/lib/friends-feeds'
import { parseFriendFeed, sortFriendArticles } from '../../src/lib/friends-feed-parser'

const friend = { name: 'Friend', url: 'https://friend.example.com/', description: '', feed: 'https://friend.example.com/rss.xml' }
const rss = '<rss version="2.0"><channel><item><title>Hello &amp; world</title><link>https://friend.example.com/hello</link><pubDate>Mon, 14 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>'
const parser = new (new JSDOM('').window.DOMParser)()
const parse = (xml: string) => parseFriendFeed({ name: friend.name, site: friend.url, status: 'ready', xml }, parser)

describe('friends RSS snapshots', () => {
  it('does no network work for an empty friends list', async () => {
    const fetcher = vi.fn()
    expect(await collectFriendFeeds([], fetcher)).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('fetches a bounded snapshot and disables redirects', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(rss))
    const result = await collectFriendFeeds([friend], fetcher)
    expect(result[0]?.status).toBe('ready')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
    expect(parse(result[0]!.xml!).articles[0]).toEqual({ title: 'Hello & world', url: 'https://friend.example.com/hello', friend: 'Friend', date: '2026-09-14T00:00:00.000Z' })
  })
  it('reports source errors separately and retains other sources', async () => {
    let calls = 0
    const fetcher = vi.fn(async () => ++calls === 1 ? new Response('bad', { status: 503 }) : new Response(rss))
    expect((await collectFriendFeeds([friend, friend], fetcher)).map(feed => feed.status)).toEqual(['unavailable', 'ready'])
  })
  it('rejects oversized streamed or declared bodies', async () => {
    for (const response of [new Response('x'.repeat(FEED_MAX_BYTES + 1)), new Response(rss, { headers: { 'content-length': String(FEED_MAX_BYTES + 1) } })]) {
      expect((await collectFriendFeeds([friend], vi.fn(async () => response)))[0]?.status).toBe('unavailable')
    }
  })
  it('limits subscriptions and rejects unsafe configured URLs', async () => {
    const fetcher = vi.fn(async () => new Response(rss))
    expect(await collectFriendFeeds([{ ...friend, feed: 'http://127.0.0.1/rss' }], fetcher)).toMatchObject([{ status: 'unavailable' }])
    expect(fetcher).not.toHaveBeenCalled()
    await collectFriendFeeds(Array.from({ length: 14 }, () => friend), fetcher)
    expect(fetcher).toHaveBeenCalledTimes(12)
  })
  it('marks request failures unavailable', async () => {
    const fetcher = vi.fn(async () => { throw new Error('timeout') })
    expect(await collectFriendFeeds([friend], fetcher)).toMatchObject([{ status: 'unavailable' }])
  })
  it('aborts a stalled source at the configured deadline', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))
      const result = collectFriendFeeds([friend], fetcher)
      await vi.advanceTimersByTimeAsync(FEED_TIMEOUT_MS)
      expect(await result).toMatchObject([{ status: 'unavailable' }])
    } finally { vi.useRealTimers() }
  })
  it.each(['http://friend.example.com', 'https://127.0.0.1', 'https://localhost', 'https://localhost.', 'https://a.local', 'https://a.local.', 'https://user:pass@friend.example.com', 'https://friend.example.com:123', 'javascript:alert(1)'])('rejects unsafe URL %s', value => {
    expect(publicHttpsUrl(value)).toBeNull()
  })
})

describe('RSS and Atom article normalization', () => {
  it('parses Atom with relative links and published dates', () => {
    const result = parse('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link rel="self" href="/feed"/><link rel="alternate" href="/atom"/><published>2026-09-13T01:02:03Z</published></entry></feed>')
    expect(result.articles[0]).toMatchObject({ title: 'Atom', url: 'https://friend.example.com/atom', date: '2026-09-13T01:02:03.000Z' })
  })
  it.each(['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>', '<rss><channel>', '<html><body>Hello</body></html>'])('marks dangerous or malformed XML unavailable', xml => {
    expect(parse(xml)).toEqual({ articles: [], available: false })
  })
  it('preserves HTML-like titles as text and rejects unsafe article links', () => {
    const result = parse('<rss><channel><item><title><![CDATA[<img onerror=alert(1)>]]></title><link>https://friend.example.com/safe</link></item><item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>')
    expect(result.articles).toEqual([{ title: '<img onerror=alert(1)>', url: 'https://friend.example.com/safe', friend: 'Friend', date: null }])
  })
  it('sorts by descending date, deduplicates, limits output and places undated entries last', () => {
    const items = Array.from({ length: 35 }, (_, i) => ({ title: `${i}`, url: `https://friend.example.com/${i}`, friend: 'Friend', date: new Date(2026, 0, i + 1).toISOString() }))
    expect(sortFriendArticles([{ ...items[0]!, date: null }, ...items, items[34]!])).toHaveLength(30)
    expect(sortFriendArticles([items[0]!, items[34]!])[0]?.title).toBe('34')
  })
  it('retains unavailable status instead of treating it as an empty valid feed', () => {
    expect(parseFriendFeed({ name: 'Friend', site: friend.url, status: 'unavailable' } as FriendFeed, parser).available).toBe(false)
  })
})
