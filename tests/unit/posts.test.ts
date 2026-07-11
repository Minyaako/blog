import { describe, expect, it } from 'vitest'
import { groupPostsByYear, toPostCard } from '../../src/lib/posts'

const normal = {
  id: 'engineering/normal',
  data: {
    id: 'post-1',
    title: 'Normal',
    description: 'Public summary',
    publishedAt: new Date('2026-07-01'),
    domain: 'engineering',
    subcategory: 'devlogs',
    tags: [],
    contentWarning: { type: 'none', message: '', scope: 'none' }
  }
}

const sensitive = {
  id: 'games/sensitive',
  data: {
    ...normal.data,
    id: 'post-2',
    title: 'Hidden',
    description: 'Leaking summary',
    publishedAt: new Date('2025-01-01'),
    domain: 'games',
    subcategory: 'reflections',
    cover: {
      url: '/images/posts/games-cover.svg',
      alt: 'Protected cover',
      credit: 'Minyako'
    },
    contentWarning: { type: 'sensitive', message: '成人向内容', scope: 'page' }
  }
}

describe('post presentation', () => {
  it('groups posts by publication year', () => {
    expect([...groupPostsByYear([normal, sensitive] as never).keys()]).toEqual([2026, 2025])
  })

  it('replaces protected summaries and covers', () => {
    const card = toPostCard(sensitive as never)
    expect(card.description).toBe('此内容需要确认后查看。')
    expect(card.cover).toBeUndefined()
  })

  it('creates a taxonomy-independent slug and permanent page key', () => {
    const card = toPostCard(normal as never)
    expect(card.slug).toBe('normal')
    expect(card.pageKey).toBe('post-1')
  })
})
