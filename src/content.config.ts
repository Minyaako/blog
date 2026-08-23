import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import {
  clearCollectionBeforeLoad,
  generateMomentContentId,
  resolveMomentContentBase,
  resolvePostContentBase,
} from './lib/content-source'
import { momentSchema } from './schemas/moment'
import { postSchema } from './schemas/post'
import { tagSchema } from './schemas/tag'

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: resolvePostContentBase() }),
  schema: postSchema
})

const tags = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/tags' }),
  schema: tagSchema
})

const moments = defineCollection({
  loader: clearCollectionBeforeLoad(glob({
    pattern: '*.mdx',
    base: resolveMomentContentBase(),
    generateId: ({ entry }) => generateMomentContentId(entry)
  })),
  schema: momentSchema
})

export const collections = { posts, tags, moments }
