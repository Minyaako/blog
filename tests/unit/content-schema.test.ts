import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('astro:content', () => ({
  defineCollection: (config: unknown) => config
}))

vi.mock('astro/loaders', () => ({
  glob: (config: unknown) => config
}))

import { collections } from '../../src/content.config'
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

  it('registers moments but keeps rankings outside astro content collections', () => {
    const source = readFileSync(new URL('../../src/content.config.ts', import.meta.url), 'utf8')
    const momentsCollection = collections.moments as unknown as {
      loader: { pattern: string; base: string; generateId?: unknown }
    }

    expect(collections).toHaveProperty('moments')
    expect(collections).not.toHaveProperty('rankings')
    expect(momentsCollection).toMatchObject({
      loader: {
        pattern: '*.mdx',
      },
    })
    expect(momentsCollection.loader).toHaveProperty('generateId')
    expect(momentsCollection.loader.base).toMatch(/^\.\/(?:src\/content|tests\/fixtures)\/moments$/)
    expect(source).toMatch(/base:\s*resolveMomentContentBase\(\)/)
    expect(source).toMatch(/pattern:\s*'\*\.mdx'/)
    expect(source).toMatch(/generateId:\s*\(\{\s*entry\s*\}\)\s*=>\s*generateMomentContentId\(entry\)/)
    expect(source).not.toMatch(/rankings/)
  })
})
