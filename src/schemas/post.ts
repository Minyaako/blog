import { z } from 'astro/zod'
import { DOMAINS, type DomainKey } from '../config/taxonomy'

const domainKeys = Object.keys(DOMAINS) as [DomainKey, ...DomainKey[]]

const assetUrlSchema = z.string().refine((value) => {
  if (value.startsWith('/')) return true

  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}, 'Expected a root-relative path or absolute URL')

const warningSchema = z.object({
  type: z.enum(['none', 'spoiler', 'sensitive']).default('none'),
  message: z.string().default(''),
  scope: z.enum(['none', 'page', 'blocks']).default('none')
})

const imageSchema = z.object({
  url: assetUrlSchema,
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
  tags: z.array(z.string()).default([]),
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
})

export type PostData = z.infer<typeof postSchema>
