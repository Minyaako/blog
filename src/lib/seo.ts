export interface SitemapPost {
  slug: string
  publishedAt: Date
  updatedAt?: Date
  domain: string
  subcategory: string
  tagIds: string[]
  collections: string[]
}

export interface SitemapMoment {
  id: string
  publishedAt: Date
  tagIds: string[]
}

export interface SitemapEntry {
  url: string
  lastmod?: string
}

interface SitemapInput {
  origin: string
  rankingIds: string[]
  posts: SitemapPost[]
  moments: SitemapMoment[]
}

const STATIC_PATHS = [
  '/',
  '/about/',
  '/archives/',
  '/moments/',
  '/projects/',
  '/ranking/',
  '/tags/',
]

const absoluteUrl = (origin: string, path: string) => new URL(path, origin).href

export function buildSitemapEntries({ origin, rankingIds, posts, moments }: SitemapInput): SitemapEntry[] {
  const entries = new Map<string, SitemapEntry>()
  const add = (path: string, lastmod?: Date) => {
    const url = absoluteUrl(origin, path)
    entries.set(url, { url, ...(lastmod ? { lastmod: lastmod.toISOString() } : {}) })
  }

  for (const path of STATIC_PATHS) add(path)
  for (const rankingId of rankingIds) add(`/ranking/${rankingId}/`)

  for (const post of posts) {
    add(`/posts/${post.slug}/`, post.updatedAt ?? post.publishedAt)
    add(`/domains/${post.domain}/`)
    add(`/domains/${post.domain}/${post.subcategory}/`)
    for (const tagId of post.tagIds) add(`/tags/${tagId}/`)
    for (const collection of post.collections) add(`/collections/${collection}/`)
  }

  for (const moment of moments) {
    add(`/moments/${moment.id}/`, moment.publishedAt)
    for (const tagId of moment.tagIds) add(`/tags/${tagId}/`)
  }

  return [...entries.values()].sort((left, right) => left.url.localeCompare(right.url))
}

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries.map(({ url, lastmod }) => (
    `<url><loc>${escapeXml(url)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>`
  )).join('')

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
}
