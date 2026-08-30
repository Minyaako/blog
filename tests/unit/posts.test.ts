import { describe, expect, it } from 'vitest'
import { getRelatedPosts, groupPostsByYear, toPostCard } from '../../src/lib/posts'

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
      media: 'post-games-cover',
      alt: 'Protected cover',
      credit: 'Minyako'
    },
    contentWarning: { type: 'sensitive', message: '成人向内容', scope: 'page' }
  }
}

const hiddenCover = {
  ...sensitive,
  data: {
    ...sensitive.data,
    id: 'post-3',
    tags: ['visual-novel', 'hide-cover']
  }
}

describe('post presentation', () => {
  it('groups posts by publication year', () => {
    expect([...groupPostsByYear([normal, sensitive] as never).keys()]).toEqual([2026, 2025])
  })

  it('keeps protected summaries without hiding covers', () => {
    const card = toPostCard(sensitive as never)
    expect(card.description).toBe('此内容需要确认后查看。')
    expect(card.cover?.id).toBe('post-games-cover')
    expect(card.cover?.url).toMatch(/^https:\/\/pic\.minyako\.top\/blog\//)
  })

  it('hides a configured cover only when the exact control tag is present', () => {
    expect(toPostCard(hiddenCover as never).cover).toBeUndefined()
    expect(
      toPostCard({
        ...hiddenCover,
        data: { ...hiddenCover.data, tags: ['visual-novel'] }
      } as never).cover
    ).toMatchObject({ id: 'post-games-cover' })
  })

  it('creates a taxonomy-independent slug and permanent page key', () => {
    const card = toPostCard(normal as never)
    expect(card.slug).toBe('normal')
    expect(card.pageKey).toBe('post-1')
  })

  it('ranks related posts by shared stable tag ids', () => {
    const current = { ...normal, data: { ...normal.data, id: 'current', tags: ['astro'] } }
    const related = { ...sensitive, data: { ...sensitive.data, tags: ['astro', 'narrative-design'] } }
    expect(getRelatedPosts(current as never, [current, related] as never)[0]?.pageKey).toBe('post-2')
  })
})
