import { z } from 'astro/zod'
import { DOMAINS, type DomainKey } from '../config/taxonomy'
import { resolveMedia } from '../lib/media'
import { getTag } from '../lib/tags'
import { TAG_ID_PATTERN } from './tag'

const domainKeys = Object.keys(DOMAINS) as [DomainKey, ...DomainKey[]]

const warningSchema = z.object({
  type: z.enum(['none', 'spoiler', 'sensitive']).default('none'),
  message: z.string().default(''),
  scope: z.enum(['none', 'page', 'blocks']).default('none')
})

const imageSchema = z.object({
  media: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
  alt: z.string(),
  credit: z.string(),
  sourceUrl: z.url().optional()
})

export const postSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]+$/),
  title: z.string().min(1),
  description: z.string().min(1),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
  domain: z.enum(domainKeys),
  subcategory: z.string().min(1),
  tags: z.array(z.string().regex(TAG_ID_PATTERN)).default([]),
  collections: z.array(z.string()).default([]),
  cover: imageSchema.optional(),
  authors: z.array(z.string()).default(['Minyako']),
  draft: z.boolean().default(false),
  featured: z.boolean().default(false),
  lang: z.literal('zh-CN').default('zh-CN'),
  translationKey: z.string().min(1),
  license: z.literal('CC-BY-4.0').default('CC-BY-4.0'),
  contentWarning: warningSchema.default({ type: 'none', message: '', scope: 'none' })
}).superRefine((post, context) => {
  const subcategories = DOMAINS[post.domain].subcategories as Record<string, { label: string }>

  if (!(post.subcategory in subcategories)) {
    context.addIssue({
      code: 'custom',
      path: ['subcategory'],
      message: `Unknown subcategory: ${post.domain}/${post.subcategory}`
    })
  }

  for (const [index, tagId] of post.tags.entries()) {
    try {
      getTag(tagId)
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['tags', index],
        message: `Unknown tag: ${tagId}`
      })
    }
  }

  if (post.cover) {
    try {
      resolveMedia(post.cover.media)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        path: ['cover', 'media'],
        message: error instanceof Error ? error.message : `Unknown media id: ${post.cover.media}`
      })
    }
  }
})

export type PostData = z.infer<typeof postSchema>
