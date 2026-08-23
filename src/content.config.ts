import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { resolvePostContentBase } from './lib/content-source'
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

export const collections = { posts, tags }
