import { describe, expect, it } from 'vitest'
import { buildSitemapEntries, renderSitemap } from '../../src/lib/seo'

describe('search engine discovery', () => {
  it('lists final trailing-slash URLs and only populated taxonomy pages', () => {
    const entries = buildSitemapEntries({
      origin: 'https://example.com',
      rankingIds: ['books'],
      posts: [
        {
          slug: 'first-post',
          publishedAt: new Date('2026-08-01T00:00:00Z'),
          domain: 'engineering',
          subcategory: 'devlogs',
          tagIds: ['astro'],
          collections: [],
        },
        {
          slug: 'second-post',
          publishedAt: new Date('2026-08-02T00:00:00Z'),
          updatedAt: new Date('2026-08-03T00:00:00Z'),
          domain: 'games',
          subcategory: 'reviews',
          tagIds: ['visual-novel'],
          collections: ['favorites'],
        },
      ],
      moments: [
        {
          id: '20260804-120000-abcdef12',
          publishedAt: new Date('2026-08-04T04:00:00Z'),
          tagIds: ['moment-tag'],
        },
      ],
    })

    expect(entries).toEqual([
      { url: 'https://example.com/' },
      { url: 'https://example.com/about/' },
      { url: 'https://example.com/archives/' },
      { url: 'https://example.com/collections/favorites/' },
      { url: 'https://example.com/domains/engineering/' },
      { url: 'https://example.com/domains/engineering/devlogs/' },
      { url: 'https://example.com/domains/games/' },
      { url: 'https://example.com/domains/games/reviews/' },
      { url: 'https://example.com/moments/' },
      {
        url: 'https://example.com/moments/20260804-120000-abcdef12/',
        lastmod: '2026-08-04T04:00:00.000Z',
      },
      {
        url: 'https://example.com/posts/first-post/',
        lastmod: '2026-08-01T00:00:00.000Z',
      },
      {
        url: 'https://example.com/posts/second-post/',
        lastmod: '2026-08-03T00:00:00.000Z',
      },
      { url: 'https://example.com/projects/' },
      { url: 'https://example.com/ranking/' },
      { url: 'https://example.com/ranking/books/' },
      { url: 'https://example.com/tags/' },
      { url: 'https://example.com/tags/astro/' },
      { url: 'https://example.com/tags/moment-tag/' },
      { url: 'https://example.com/tags/visual-novel/' },
    ])
    expect(entries.some(({ url }) => url.includes('/search/'))).toBe(false)
    expect(entries.some(({ url }) => url.includes('/domains/life/'))).toBe(false)
  })

  it('renders an XML URL set with escaped absolute locations', () => {
    expect(renderSitemap([
      { url: 'https://example.com/posts/a&b/', lastmod: '2026-08-01T00:00:00.000Z' },
    ])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      '<url><loc>https://example.com/posts/a&amp;b/</loc><lastmod>2026-08-01T00:00:00.000Z</lastmod></url>' +
      '</urlset>',
    )
  })
})
