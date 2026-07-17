import { z } from 'astro/zod'

export const TAG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const tagSchema = z.object({
  id: z.string().regex(TAG_ID_PATTERN, 'Tag id must use lowercase letters, numbers, and hyphens'),
  label: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).default([]),
  description: z.string().trim().min(1)
})

export type Tag = z.infer<typeof tagSchema>
