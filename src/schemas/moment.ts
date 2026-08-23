import { z } from 'astro/zod'
import { TAG_ID_PATTERN } from './tag'

export const MOMENT_ID_PATTERN = /^\d{8}-\d{6}-[a-f0-9]{8}$/
export const EXPLICIT_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/

function hasValidExplicitZone(value: string): boolean {
  const match = /(?<zone>Z|(?<sign>[+-])(?<hour>\d{2}):(?<minute>\d{2}))$/.exec(value)
  if (!match?.groups) return false
  if (match.groups.zone === 'Z') return true
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  return Number.isInteger(hour)
    && Number.isInteger(minute)
    && hour >= 0
    && hour <= 14
    && minute >= 0
    && minute <= 59
    && (hour < 14 || minute === 0)
}

export const momentSchema = z.object({
  id: z.string().regex(MOMENT_ID_PATTERN),
  title: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional()
  ),
  publishedAt: z.string().refine((value) => (
    EXPLICIT_ZONE_PATTERN.test(value) && hasValidExplicitZone(value) && Number.isFinite(Date.parse(value))
  ), 'publishedAt must be an ISO 8601 date-time with an explicit time zone'),
  tags: z.array(z.string().regex(TAG_ID_PATTERN)).default([]),
  pinned: z.boolean().default(false),
  contentWarning: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional()
  )
})

export type MomentData = z.infer<typeof momentSchema>
