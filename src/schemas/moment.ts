import { z } from 'astro/zod'
import { TAG_ID_PATTERN } from './tag'

export const MOMENT_ID_PATTERN = /^\d{8}-\d{6}-[a-f0-9]{8}$/
export const EXPLICIT_ZONE_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function hasValidExplicitZone(match: RegExpExecArray): boolean {
  if (!match?.groups) return false
  if (match.groups.zone === 'Z') return true
  const hour = Number(match.groups.offsetHour)
  const minute = Number(match.groups.offsetMinute)
  return Number.isInteger(hour)
    && Number.isInteger(minute)
    && hour >= 0
    && hour <= 14
    && minute >= 0
    && minute <= 59
    && (hour < 14 || minute === 0)
}

export function isStrictMomentPublishedAt(value: string): boolean {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?(?<zone>Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/.exec(value)
  if (!match?.groups) return false
  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const hour = Number(match.groups.hour)
  const minute = Number(match.groups.minute)
  const second = Number(match.groups.second)

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || !Number.isInteger(second)) return false
  if (hour < 0 || hour > 23) return false
  if (minute < 0 || minute > 59) return false
  if (second < 0 || second > 59) return false
  return hasValidExplicitZone(match)
}

export const momentImageSchema = z.object({
  media: z.string().trim().min(1),
  alt: z.string().trim().min(1),
  caption: z.string().trim().min(1).optional(),
}).strict()

export const momentSchema = z.object({
  id: z.string().regex(MOMENT_ID_PATTERN),
  title: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional()
  ),
  publishedAt: z.string().refine((value) => (
    EXPLICIT_ZONE_PATTERN.test(value) && isStrictMomentPublishedAt(value)
  ), 'publishedAt must be an ISO 8601 date-time with an explicit time zone'),
  tags: z.array(z.string().regex(TAG_ID_PATTERN)).default([]),
  images: z.array(momentImageSchema).default([]),
  track: z.string().trim().min(1).optional(),
  pinned: z.boolean().default(false),
  contentWarning: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional()
  )
})

export type MomentData = z.infer<typeof momentSchema>
