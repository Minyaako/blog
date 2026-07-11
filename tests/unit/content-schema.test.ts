import { describe, expect, it } from 'vitest'
import { postSchema } from '../../src/schemas/post'

const validPost = {
  id: 'engineering-schema-example',
  title: 'Schema Example',
  description: 'A valid post.',
  publishedAt: '2026-07-12',
  domain: 'engineering',
  subcategory: 'devlogs',
  tags: ['astro'],
  collections: [],
  cover: {
    url: '/images/posts/engineering-cover.svg',
    alt: 'Geometric amber cover',
    credit: 'Minyako'
  },
  authors: ['Minyako'],
  draft: false,
  featured: true,
  lang: 'zh-CN',
  translationKey: 'engineering-schema-example',
  license: 'CC-BY-4.0',
  contentWarning: { type: 'none', message: '', scope: 'none' }
}

describe('post schema', () => {
  it('accepts a configured domain and root-relative cover', () => {
    expect(postSchema.parse(validPost).domain).toBe('engineering')
  })

  it('rejects a subcategory owned by another domain', () => {
    expect(() => postSchema.parse({ ...validPost, domain: 'life', subcategory: 'gallery' }))
      .toThrow('Unknown subcategory: life/gallery')
  })
})
