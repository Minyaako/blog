import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { postSchema } from './schemas/post'
import { tagSchema } from './schemas/tag'

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: postSchema
})

const tags = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/tags' }),
  schema: tagSchema
})

export const collections = { posts, tags }
