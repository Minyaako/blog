import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLinkMetadata, identifyLink } from '../../src/lib/link-card-metadata.mjs'

const temporary: string[] = []
const github = identifyLink('https://github.com/astro/astro')!
const youtube = identifyLink('https://youtu.be/dQw4w9WgXcQ')!
const now = Date.parse('2026-09-13T00:00:00Z')
const repository = {
  full_name: 'astro/astro', description: 'A web framework', owner: { login: 'astro', avatar_url: 'https://avatars.githubusercontent.com/u/123' },
  stargazers_count: 51000, forks_count: 0
}
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
async function cache() {
  const directory = await mkdtemp(join(tmpdir(), 'blog-link-cards-'))
  temporary.push(directory)
  return directory
}
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('link-card resource identification', () => {
  it.each([
    ['http://github.com/astro/astro.git?tab=readme#readme', 'github', 'https://github.com/astro/astro?tab=readme#readme', 'astro/astro'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30', 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=tracking', 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333', 'bilibili', 'https://www.bilibili.com/video/BV1xx411c7mD/', 'BV1xx411c7mD'],
    ['https://bilibili.com/video/av170001', 'bilibili', 'https://www.bilibili.com/video/av170001/', 'av170001'],
    ['https://zhuanlan.zhihu.com/p/1234?utm_source=copy', 'zhihu', 'https://zhuanlan.zhihu.com/p/1234', 'p/1234'],
    ['https://zhihu.com/question/123/answer/456', 'zhihu', 'https://www.zhihu.com/question/123/answer/456', 'question/123/answer/456']
  ])('canonicalizes %s', (input, provider, url, id) => {
    expect(identifyLink(input)).toMatchObject({ provider, url, id })
  })

  it('preserves video timestamps, playlist context and Bilibili part selection while removing tracking', () => {
    expect(identifyLink('https://youtu.be/dQw4w9WgXcQ?t=1m30s&list=PL_123&index=2&si=tracking')?.url)
      .toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s&list=PL_123&index=2')
    expect(identifyLink('https://www.bilibili.com/video/BV1xx411c7mD/?p=3&t=60&spm_id_from=333')?.url)
      .toBe('https://www.bilibili.com/video/BV1xx411c7mD/?p=3&t=60')
  })

  it('preserves repository tabs and README anchors while removing tracking', () => {
    expect(identifyLink('https://github.com/astro/astro?tab=license-1-ov-file&utm_source=share#installation')?.url)
      .toBe('https://github.com/astro/astro?tab=license-1-ov-file#installation')
  })

  it.each([
    ['https://zhuanlan.zhihu.com/p/1234#section-2', 'https://zhuanlan.zhihu.com/p/1234#section-2'],
    ['https://zhihu.com/question/123/answer/456#section', 'https://www.zhihu.com/question/123/answer/456#section'],
    ['https://youtu.be/dQw4w9WgXcQ#t=30', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=30'],
    ['https://bilibili.com/video/av170001#comment', 'https://www.bilibili.com/video/av170001/#comment']
  ])('preserves content fragments: %s', (input, expected) => {
    expect(identifyLink(input)?.url).toBe(expected)
  })

  it.each([
    'https://github.com.evil.test/astro/astro', 'https://github.com@127.0.0.1/astro/astro',
    'https://user:password@github.com/astro/astro', 'https://github.com:444/astro/astro',
    'file:///github.com/astro/astro', 'javascript:alert(1)', 'https://localhost/astro/astro',
    'https://github.com/astro/astro/issues/1', 'https://github.com/astro',
    'https://github.com/astro/%2e%2e', 'https://github.com/astro/repo%2fother',
    'https://github.com\\@evil.test/astro/astro', ' https://github.com/astro/astro',
    'https://youtu.be/short', 'https://www.youtube.com/playlist?list=123',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ/evil', 'https://b23.tv/abc',
    'https://www.bilibili.com/video/BVbad', 'https://www.zhihu.com/question/123',
    'https://zhuanlan.zhihu.com/p/-1', 'https://example.org/article'
  ])('does not identify unsupported or unsafe URLs: %s', (input) => {
    expect(identifyLink(input)).toBeNull()
  })
})

describe('build-time link metadata', () => {
  it('fetches public GitHub data with fixed endpoint and preserves real zero counts', async () => {
    const fetch = vi.fn(async (_url: string) => json(repository))
    const result = await getLinkMetadata(github, { fetch, cacheDir: await cache(), now, offline: false })
    expect(result).toEqual({ title: 'astro/astro', description: 'A web framework', author: 'astro',
      stats: [{ label: 'Stars', value: 51000 }, { label: 'Forks', value: 0 }],
      fetchedAt: '2026-09-13T00:00:00.000Z' })
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/astro/astro', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
  })

  it('revalidates the resource instead of trusting caller-supplied provider or IDs', async () => {
    const fetch = vi.fn(async (_url: string) => json(repository))
    await getLinkMetadata({ ...github, id: '../../secret', provider: 'zhihu' }, { fetch, cacheDir: await cache(), offline: false })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/astro/astro')
    expect(await getLinkMetadata({ url: 'http://127.0.0.1/secret' }, { fetch, offline: false })).toEqual({ title: '链接' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses fresh cache and deduplicates simultaneous requests', async () => {
    const cacheDir = await cache()
    const fetch = vi.fn(async () => json(repository))
    const results = await Promise.all(Array.from({ length: 8 }, (_, offset) => getLinkMetadata(github, { fetch, cacheDir, now: now + offset, offline: false })))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(results.every((value) => value.title === 'astro/astro')).toBe(true)
    await getLinkMetadata(github, { fetch, cacheDir, now: now + 23 * 3600000, offline: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    await getLinkMetadata(github, { fetch, cacheDir, now: now + 25 * 3600000, offline: false })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shares metadata between navigation targets for the same resource', async () => {
    const cacheDir = await cache()
    const fetch = vi.fn(async (_url: string) => json(repository))
    await getLinkMetadata(identifyLink('https://github.com/astro/astro#installation'), { fetch, cacheDir, now, offline: false })
    await getLinkMetadata(identifyLink('https://github.com/astro/astro?tab=license-1-ov-file'), { fetch, cacheDir, now: now + 10, offline: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/astro/astro')
  })

  it('retains successful stale metadata when refresh fails and retries after one hour', async () => {
    const cacheDir = await cache()
    const fetch = vi.fn().mockResolvedValueOnce(json(repository)).mockRejectedValue(new Error('offline'))
    const original = await getLinkMetadata(github, { fetch, cacheDir, now, offline: false })
    const later = now + 25 * 3600000
    expect(await getLinkMetadata(github, { fetch, cacheDir, now: later, offline: false })).toEqual(original)
    await getLinkMetadata(github, { fetch, cacheDir, now: later + 3599999, offline: false })
    expect(fetch).toHaveBeenCalledTimes(2)
    await getLinkMetadata(github, { fetch, cacheDir, now: later + 3600001, offline: false })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('caches failures without inventing statistics and tolerates damaged cache files', async () => {
    const cacheDir = await cache()
    const fetch = vi.fn(async () => new Response('denied', { status: 403 }))
    expect(await getLinkMetadata(github, { fetch, cacheDir, now, offline: false })).toEqual({ title: 'astro/astro' })
    await getLinkMetadata(github, { fetch, cacheDir, now: now + 100, offline: false })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [filename] = await readdir(cacheDir)
    await writeFile(join(cacheDir, filename), '{bad json')
    await getLinkMetadata(github, { fetch, cacheDir, now: now + 200, offline: false })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses public YouTube oEmbed without an API key and omits unknown counts', async () => {
    const fetch = vi.fn(async (_url: string) => json({ title: 'Video title', author_name: 'Creator', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }))
    const result = await getLinkMetadata(youtube, { fetch, cacheDir: await cache(), now, apiKey: '', offline: false })
    expect(result).toMatchObject({ title: 'Video title', author: 'Creator' })
    expect(result.stats).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toContain('https://www.youtube.com/oembed?url=')
  })

  it('adds optional YouTube statistics without serializing API keys', async () => {
    const cacheDir = await cache()
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ title: 'Video title', author_name: 'Creator' }))
      .mockResolvedValueOnce(json({ items: [{ snippet: { description: 'About the video' }, statistics: { viewCount: '12345', likeCount: '0' } }] }))
    const result = await getLinkMetadata(youtube, { fetch, cacheDir, now, apiKey: 'private-api-key', offline: false })
    expect(result.stats).toEqual([{ label: '播放', value: 12345 }, { label: '点赞', value: 0 }])
    expect(result.description).toBe('About the video')
    const [filename] = await readdir(cacheDir)
    expect(await readFile(join(cacheDir, filename), 'utf8')).not.toContain('private-api-key')
    expect(JSON.stringify(result)).not.toContain('private-api-key')
    expect(fetch.mock.calls[1][0]).toContain('https://www.googleapis.com/youtube/v3/videos?')
  })

  it('keeps YouTube cards useful when optional statistics fail', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ title: 'Public title' })).mockRejectedValueOnce(new Error('quota exhausted'))
    const result = await getLinkMetadata(youtube, { fetch, cacheDir: await cache(), now, apiKey: 'private-key', offline: false })
    expect(result.title).toBe('Public title')
    expect(result.stats).toBeUndefined()
  })

  it('reads Bilibili title, owner, cover, views and likes', async () => {
    const link = identifyLink('https://www.bilibili.com/video/BV1xx411c7mD/')!
    const fetch = vi.fn(async (_url: string) => json({ code: 0, data: { title: '视频', desc: '简介', pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg', owner: { name: '作者' }, stat: { view: 100, like: 25 } } }))
    expect(await getLinkMetadata(link, { fetch, cacheDir: await cache(), now, offline: false })).toMatchObject({
      title: '视频', description: '简介', author: '作者', image: 'https://i0.hdslb.com/bfs/archive/cover.jpg', stats: [{ label: '播放', value: 100 }, { label: '点赞', value: 25 }]
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.bilibili.com/x/web-interface/view?bvid=BV1xx411c7mD')
  })

  it('extracts public Zhihu OG metadata as text and accepts either attribute order', async () => {
    const link = identifyLink('https://zhuanlan.zhihu.com/p/1234')!
    const fetch = vi.fn(async () => new Response(`<html><meta content='A &amp; B &lt;script&gt;' property='og:title'><meta name="description" content="Description &#x4e2d; &#25991;"><meta property="og:image" content="https://pic1.zhimg.com/cover.jpg"><meta name="author" content="Writer"></html>`))
    expect(await getLinkMetadata(link, { fetch, cacheDir: await cache(), now, offline: false })).toMatchObject({
      title: 'A & B <script>', description: 'Description 中 文', author: 'Writer', image: 'https://pic1.zhimg.com/cover.jpg'
    })
  })

  it('rejects untrusted images, malformed counts and overly long metadata', async () => {
    const fetch = vi.fn(async () => json({ ...repository, description: 'x'.repeat(1000), owner: { login: 'a\u0000b', avatar_url: 'https://avatars.githubusercontent.com.evil.test/track' }, stargazers_count: -1, forks_count: 'NaN' }))
    const result = await getLinkMetadata(github, { fetch, cacheDir: await cache(), now, offline: false })
    expect(result.description).toHaveLength(420)
    expect(result.author).toBe('a b')
    expect(result.image).toBeUndefined()
    expect(result.stats).toBeUndefined()
  })

  it.each(['BLOG_E2E_FIXTURES', 'BLOG_MOMENT_FIXTURES', 'BLOG_E2E_EMPTY_CONTENT'])('never fetches for offline fixture mode %s', async (name) => {
    vi.stubEnv(name, 'true')
    const fetch = vi.fn()
    expect(await getLinkMetadata(github, { fetch, cacheDir: await cache(), now })).toEqual({ title: 'astro/astro' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    () => new Response('{}', { headers: { 'content-length': '1048577' } }),
    () => new Response('x'.repeat(1048577)),
    () => new Response('{invalid json')
  ])('degrades safely on redirects, oversized bodies and invalid responses', async (response) => {
    const fetch = vi.fn(async () => response())
    expect(await getLinkMetadata(github, { fetch, cacheDir: await cache(), now, offline: false })).toEqual({ title: 'astro/astro' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('limits concurrent requests to four', async () => {
    const cacheDir = await cache()
    let active = 0
    let maximum = 0
    const fetch = vi.fn(async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return json(repository)
    })
    await Promise.all(Array.from({ length: 12 }, (_, index) => getLinkMetadata(identifyLink(`https://github.com/astro/repo-${index}`), { fetch, cacheDir, now, offline: false })))
    expect(maximum).toBe(4)
  })

  it('aborts a stalled provider request within four seconds', async () => {
    const fetch = vi.fn(async (_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const started = Date.now()
    expect(await getLinkMetadata(github, { fetch, cacheDir: await cache(), now, offline: false })).toEqual({ title: 'astro/astro' })
    expect(Date.now() - started).toBeLessThan(4500)
  }, 6000)

  it('caps uncached fetches per build at eighty', async () => {
    const cacheDir = await cache()
    const fetch = vi.fn(async () => json(repository))
    const result = await Promise.all(Array.from({ length: 82 }, (_, index) => getLinkMetadata(identifyLink(`https://github.com/astro/budget-${index}`), { fetch, cacheDir, now, offline: false })))
    expect(fetch).toHaveBeenCalledTimes(80)
    expect(result.filter((metadata) => metadata.fetchedAt)).toHaveLength(80)
  })
})
