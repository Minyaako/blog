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
    media: 'post-engineering-cover',
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
  it('accepts a configured domain and locked cover id', () => {
    expect(postSchema.parse(validPost).domain).toBe('engineering')
  })

  it('rejects a subcategory owned by another domain', () => {
    expect(() => postSchema.parse({ ...validPost, domain: 'life', subcategory: 'gallery' }))
      .toThrow('Unknown subcategory: life/gallery')
  })

  it('rejects unknown stable tag ids', () => {
    expect(() => postSchema.parse({ ...validPost, tags: ['missing-tag'] }))
      .toThrow('Unknown tag: missing-tag')
  })

  it('rejects an unknown media id', () => {
    expect(() => postSchema.parse({
      ...validPost,
      cover: { ...validPost.cover, media: 'missing-cover' }
    })).toThrow('Unknown media id: missing-cover')
  })
})
