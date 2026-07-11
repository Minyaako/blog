import { describe, expect, it } from 'vitest'
import { toFeedItem } from '../../src/lib/posts'

describe('RSS safety', () => {
  it('does not expose protected descriptions or covers', () => {
    const post = {
      id: 'games/hidden.mdx',
      data: {
        id: 'games-hidden', title: 'Hidden', description: 'raw protected description',
        publishedAt: new Date('2026-07-10'), domain: 'games', subcategory: 'reflections',
        tags: ['视觉小说'], collections: [], authors: ['Minyako'], draft: false, featured: false,
        lang: 'zh-CN', translationKey: 'games-hidden', license: 'CC-BY-4.0',
        cover: { url: '/secret-cover.png', alt: 'secret', credit: 'owner' },
        contentWarning: { type: 'sensitive', message: '提示', scope: 'page' }
      }
    }
    const item = toFeedItem(post as never)
    const serialized = JSON.stringify(item)
    expect(serialized).toContain('此内容需要确认后查看。')
    expect(serialized).not.toContain('raw protected description')
    expect(serialized).not.toContain('/secret-cover.png')
  })
})
