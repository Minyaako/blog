import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const DAY = 86_400_000
const HOUR = 3_600_000
const MAX_BODY = 1_048_576
const inflight = new Map()
const requestCounts = new WeakMap()
let activeRequests = 0
const waiting = []

/** Recognize resource links only; every returned URL is reconstructed from validated IDs. */
export function identifyLink(input) {
  if (typeof input !== 'string' || input.length > 2048 || /[\u0000-\u0020\\]/u.test(input)) return null
  let parsed
  try { parsed = new URL(input) } catch { return null }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.port) return null
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/\/$/u, '')
  let match
  if (host === 'github.com' && (match = /^\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]{1,100})$/iu.exec(path))) {
    const owner = match[1]
    const repo = match[2].replace(/\.git$/iu, '')
    if (!repo || repo === '.' || repo === '..') return null
    const id = `${owner}/${repo}`
    const target = new URL(`https://github.com/${id}`)
    const tab = parsed.searchParams.get('tab')
    if (tab && /^[\w-]{1,80}$/u.test(tab)) target.searchParams.set('tab', tab)
    target.hash = parsed.hash
    return { provider: 'github', url: target.href, id, label: 'GitHub' }
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    const id = host === 'youtu.be' ? path.slice(1)
      : path === '/watch' ? parsed.searchParams.get('v')
        : /^\/shorts\/([\w-]{11})$/u.exec(path)?.[1]
    if (typeof id === 'string' && /^[\w-]{11}$/u.test(id)) {
      const target = new URL(`https://www.youtube.com/watch?v=${id}`)
      for (const [name, pattern] of [['t', /^(?:\d{1,7}|(?:\d{1,3}h)?(?:\d{1,3}m)?(?:\d{1,5}s)?)$/u], ['start', /^\d{1,7}$/u], ['list', /^[\w-]{1,100}$/u], ['index', /^[1-9]\d{0,4}$/u]]) {
        const value = parsed.searchParams.get(name)
        if (value && pattern.test(value)) target.searchParams.set(name, value)
      }
      target.hash = parsed.hash
      return { provider: 'youtube', url: target.href, id, label: 'YouTube' }
    }
  }
  if (['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(host) &&
    (match = /^\/video\/(BV[a-z\d]{10}|av[1-9]\d{0,18})$/iu.exec(path))) {
    const id = /^av/iu.test(match[1]) ? match[1].toLowerCase() : `BV${match[1].slice(2)}`
    const target = new URL(`https://www.bilibili.com/video/${id}/`)
    for (const [name, pattern] of [['p', /^[1-9]\d{0,4}$/u], ['t', /^\d{1,7}$/u]]) {
      const value = parsed.searchParams.get(name)
      if (value && pattern.test(value)) target.searchParams.set(name, value)
    }
    target.hash = parsed.hash
    return { provider: 'bilibili', url: target.href, id, label: '哔哩哔哩' }
  }
  if (host === 'zhuanlan.zhihu.com' && (match = /^\/p\/([1-9]\d{0,19})$/u.exec(path))) {
    return { provider: 'zhihu', url: `https://zhuanlan.zhihu.com/p/${match[1]}${parsed.hash}`, id: `p/${match[1]}`, label: '知乎' }
  }
  if (['www.zhihu.com', 'zhihu.com'].includes(host) &&
    (match = /^\/question\/([1-9]\d{0,19})\/answer\/([1-9]\d{0,19})$/u.exec(path))) {
    const id = `question/${match[1]}/answer/${match[2]}`
    return { provider: 'zhihu', url: `https://www.zhihu.com/${id}${parsed.hash}`, id, label: '知乎' }
  }
  return null
}

function cleanText(value, limit = 240) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, limit) : ''
}

function safeImage(value, provider) {
  if (typeof value !== 'string') return undefined
  let url
  try { url = new URL(value.replace(/^http:/u, 'https:')) } catch { return undefined }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
  const allowed = {
    github: /^opengraph\.githubassets\.com$/u,
    youtube: /^(?:i\.ytimg\.com|img\.youtube\.com)$/u,
    bilibili: /^i[0-2]\.hdslb\.com$/u,
    zhihu: /^(?:pic[1-4x]|pica|picx)\.zhimg\.com$/u
  }
  return allowed[provider]?.test(url.hostname) && url.href.length <= 2048 ? url.href : undefined
}

function count(value) {
  if (typeof value === 'string' && /^\d+$/u.test(value)) value = Number(value)
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function statistic(label, value) {
  const normalized = count(value)
  return normalized === undefined ? [] : [{ label, value: normalized }]
}

function fallback(link) {
  const title = link.provider === 'github' ? link.id : link.provider === 'zhihu'
    ? `知乎${link.id.startsWith('p/') ? '文章' : '回答'} · ${link.id.split('/').at(-1)}`
    : `${link.label} 视频 · ${link.id}`
  return { title }
}

function sanitize(data, link, apiKey) {
  const scrub = (value, limit) => {
    const text = cleanText(value, limit)
    return apiKey ? text.split(apiKey).join('[redacted]') : text
  }
  const result = { title: scrub(data?.title, 240) || fallback(link).title }
  for (const [key, limit] of [['description', 420], ['author', 100]]) {
    const value = scrub(data?.[key], limit)
    if (value) result[key] = value
  }
  const image = safeImage(data?.image, link.provider)
  if (image && (!apiKey || !image.includes(apiKey))) result.image = image
  const allowedLabels = link.provider === 'github' ? ['Stars', 'Forks'] : ['播放', '点赞']
  const stats = Array.isArray(data?.stats) ? data.stats.flatMap((item) =>
    item && allowedLabels.includes(item.label) ? statistic(item.label, item.value) : []).slice(0, 2) : []
  if (stats.length) result.stats = stats
  if (typeof data?.fetchedAt === 'string' && Number.isFinite(Date.parse(data.fetchedAt))) result.fetchedAt = data.fetchedAt
  return result
}

async function limitedFetch(url, fetchImpl) {
  const used = requestCounts.get(fetchImpl) || 0
  if (used >= 80) throw new Error('Link metadata request budget exhausted')
  requestCounts.set(fetchImpl, used + 1)
  if (activeRequests >= 4) await new Promise((resolve) => waiting.push(resolve))
  else activeRequests += 1
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetchImpl(url, {
      redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json,text/html;q=0.9', 'User-Agent': 'MinyakoBlog-LinkCards/1.0' }
    })
    if (!response.ok || response.status >= 300) throw new Error('Metadata unavailable')
    if (Number(response.headers.get('content-length')) > MAX_BODY) throw new Error('Metadata too large')
    if (!response.body) throw new Error('Empty metadata')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let text = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_BODY) throw new Error('Metadata too large')
        text += decoder.decode(value, { stream: true })
      }
      return text + decoder.decode()
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } finally {
    clearTimeout(timeout)
    const next = waiting.shift()
    if (next) next()
    else activeRequests -= 1
  }
}

function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/giu, (entity, code) => {
    if (code.startsWith('#')) {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[code.toLowerCase()] || entity
  })
}

function openGraph(html) {
  const values = {}
  for (const tag of html.match(/<meta\b[^>]*>/giu) || []) {
    const attrs = {}
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4])
    }
    const name = attrs.property || attrs.name
    if (name && attrs.content) values[name.toLowerCase()] = attrs.content
  }
  return values
}

async function fetchMetadata(link, fetchImpl, apiKey) {
  const json = async (url) => JSON.parse(await limitedFetch(url, fetchImpl))
  if (link.provider === 'github') {
    const data = await json(`https://api.github.com/repos/${link.id}`)
    if (!data.full_name) throw new Error('Missing repository')
    return { title: data.full_name, description: data.description, author: data.owner?.login,
      stats: [...statistic('Stars', data.stargazers_count), ...statistic('Forks', data.forks_count)] }
  }
  if (link.provider === 'youtube') {
    const data = await json(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.id}`)}&format=json`)
    if (!cleanText(data.title)) throw new Error('Missing video')
    const metadata = { title: data.title, author: data.author_name, image: data.thumbnail_url }
    if (apiKey) {
      try {
        const details = await json(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${link.id}&key=${encodeURIComponent(apiKey)}`)
        const video = details.items?.[0]
        if (video) {
          metadata.description = video.snippet?.description
          metadata.stats = [...statistic('播放', video.statistics?.viewCount), ...statistic('点赞', video.statistics?.likeCount)]
        }
      } catch { /* Public oEmbed remains useful when optional statistics are unavailable. */ }
    }
    return metadata
  }
  if (link.provider === 'bilibili') {
    const query = link.id.startsWith('av') ? `aid=${link.id.slice(2)}` : `bvid=${link.id}`
    const result = await json(`https://api.bilibili.com/x/web-interface/view?${query}`)
    if (result.code !== 0 || !cleanText(result.data?.title)) throw new Error('Missing video')
    const data = result.data
    return { title: data.title, description: data.desc, author: data.owner?.name, image: data.pic,
      stats: [...statistic('播放', data.stat?.view), ...statistic('点赞', data.stat?.like)] }
  }
  const values = openGraph(await limitedFetch(link.url.split('#')[0], fetchImpl))
  if (!cleanText(values['og:title'])) throw new Error('Missing article metadata')
  return { title: values['og:title'], description: values['og:description'] || values.description,
    image: values['og:image'], author: values['article:author'] || values.author }
}

/** Build-only metadata. Network failures never prevent rendering a usable link card. */
export async function getLinkMetadata(input, options = {}) {
  // Re-identification prevents forged provider/ID objects from becoming request targets.
  const link = identifyLink(input?.url)
  if (!link) return { title: '链接' }
  const offline = options.offline ?? ['BLOG_E2E_FIXTURES', 'BLOG_MOMENT_FIXTURES', 'BLOG_E2E_EMPTY_CONTENT']
    .some((name) => process.env[name] === 'true')
  if (offline) return fallback(link)
  const fetchImpl = options.fetch ?? globalThis.fetch
  const apiKey = options.apiKey ?? process.env.YOUTUBE_DATA_API_KEY ?? ''
  const cacheDir = options.cacheDir ?? join(process.cwd(), 'node_modules', '.cache', 'blog-link-cards')
  const now = typeof options.now === 'function' ? options.now() : options.now ?? Date.now()
  const identity = `${link.provider}:${link.id}`
  const key = createHash('sha256').update(`v1:${identity}:${link.provider === 'youtube' && !!apiKey}`).digest('hex')
  const path = join(cacheDir, `${key}.json`)
  const pendingKey = path
  if (inflight.has(pendingKey)) return inflight.get(pendingKey)
  const task = (async () => {
    let cached
    try {
      const text = await readFile(path, 'utf8')
      if (text.length <= MAX_BODY) {
        const candidate = JSON.parse(text)
        if (candidate.version === 1 && candidate.identity === identity && Number.isFinite(candidate.checkedAt) &&
          candidate.checkedAt <= now && candidate.metadata && typeof candidate.metadata.title === 'string') cached = candidate
      }
    } catch { /* A missing or damaged cache is a normal cache miss. */ }
    if (cached && now - cached.checkedAt < (cached.failed ? HOUR : DAY)) return sanitize(cached.metadata, link, apiKey)
    let metadata
    let failed = false
    try {
      metadata = sanitize({ ...await fetchMetadata(link, fetchImpl, apiKey), fetchedAt: new Date(now).toISOString() }, link, apiKey)
    } catch {
      failed = true
      metadata = cached ? sanitize(cached.metadata, link, apiKey) : fallback(link)
    }
    try {
      await mkdir(cacheDir, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify({ version: 1, identity, checkedAt: now, failed, metadata }), 'utf8')
      await rename(temporary, path)
    } catch { /* Read-only or unavailable cache directories cannot fail the build. */ }
    return metadata
  })()
  inflight.set(pendingKey, task)
  try { return await task } finally { inflight.delete(pendingKey) }
}
