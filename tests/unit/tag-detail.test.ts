import { describe, expect, it } from 'vitest'
import { buildTagDetailSections } from '../../src/lib/tag-detail'

const tag = {
  id: 'visual-novel',
  label: '视觉小说',
  aliases: ['VN'],
  description: '与视觉小说相关。',
} as const

describe('tag detail sections', () => {
  it('returns only posts and moments that reference the requested tag id', () => {
    const sections = buildTagDetailSections(tag, [
      {
        slug: 'match-post',
        title: '匹配文章',
        description: 'desc',
        pageKey: 'match-post',
        publishedAt: new Date('2026-07-12T00:00:00+08:00'),
        domain: 'games',
        subcategory: 'reviews',
        tags: [{ id: 'visual-novel', label: '视觉小说', aliases: [], description: '' }],
        protected: false,
      },
      {
        slug: 'other-post',
        title: '无关文章',
        description: 'desc',
        pageKey: 'other-post',
        publishedAt: new Date('2026-07-13T00:00:00+08:00'),
        domain: 'games',
        subcategory: 'reviews',
        tags: [{ id: 'life-notes', label: '生活札记', aliases: [], description: '' }],
        protected: false,
      },
    ], [
      {
        id: '20260823-143501-a7c31e4f',
        title: '匹配动态',
        publishedAt: new Date('2026-08-23T14:35:01+08:00'),
        pinned: false,
        images: [],
        tags: [{ id: 'visual-novel', label: '视觉小说', aliases: [], description: '' }],
        entry: {} as never,
      },
      {
        id: '20260823-143502-a7c31e4f',
        title: '无关动态',
        publishedAt: new Date('2026-08-23T15:35:01+08:00'),
        pinned: false,
        images: [],
        tags: [{ id: 'life-notes', label: '生活札记', aliases: [], description: '' }],
        entry: {} as never,
      },
    ])

    expect(sections.posts.map((post) => post.title)).toEqual(['匹配文章'])
    expect(sections.moments.map((moment) => moment.title)).toEqual(['匹配动态'])
  })

  it('preserves coexistence when a tag has both posts and moments and marks empty states separately', () => {
    const both = buildTagDetailSections(tag, [
      {
        slug: 'match-post',
        title: '匹配文章',
        description: 'desc',
        pageKey: 'match-post',
        publishedAt: new Date('2026-07-12T00:00:00+08:00'),
        domain: 'games',
        subcategory: 'reviews',
        tags: [{ id: 'visual-novel', label: '视觉小说', aliases: [], description: '' }],
        protected: false,
      },
    ], [
      {
        id: '20260823-143501-a7c31e4f',
        title: '匹配动态',
        publishedAt: new Date('2026-08-23T14:35:01+08:00'),
        pinned: false,
        images: [],
        tags: [{ id: 'visual-novel', label: '视觉小说', aliases: [], description: '' }],
        entry: {} as never,
      },
    ])
    const empty = buildTagDetailSections(tag, [], [])

    expect(both.hasPosts).toBe(true)
    expect(both.hasMoments).toBe(true)
    expect(empty.hasPosts).toBe(false)
    expect(empty.hasMoments).toBe(false)
  })
})
