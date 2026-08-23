import type { CollectionEntry } from 'astro:content'
import { getTag, type Tag } from './tags'
import { isStrictMomentPublishedAt, type MomentData } from '../schemas/moment'

export interface MomentEntryLike {
  id: string
  body?: string
  data: MomentData
}

export interface MomentView {
  entry: CollectionEntry<'moments'>
  id: string
  title?: string
  publishedAt: Date
  tags: Tag[]
  pinned: boolean
  contentWarning?: string
}

const MOMENT_ENTRY_ID_PATTERN = /^\d{8}-\d{6}-[a-f0-9]{8}\.mdx$/

function entryBasename(id: string) {
  if (!MOMENT_ENTRY_ID_PATTERN.test(id)) {
    throw new Error(`Moment entry must be a top-level src/content/moments/{id}.mdx file: ${id}`)
  }
  return id.replace(/\.mdx$/i, '')
}

function assertMomentEntry(entry: MomentEntryLike, seenIds: Set<string>) {
  const filenameId = entryBasename(entry.id)

  if (filenameId !== entry.data.id) {
    throw new Error(`Moment filename must equal id: filename ${filenameId} does not match id ${entry.data.id}`)
  }

  if (seenIds.has(entry.data.id)) {
    throw new Error(`Duplicate moment id: ${entry.data.id}`)
  }
  seenIds.add(entry.data.id)

  if (typeof entry.body !== 'string' || entry.body.trim() === '') {
    throw new Error(`Moment body must not be empty: ${entry.data.id}`)
  }

  if (!isStrictMomentPublishedAt(entry.data.publishedAt)) {
    throw new Error(`Moment publishedAt must be a strict RFC3339 timestamp: ${entry.data.id}`)
  }

  const seenTags = new Set<string>()
  for (const tagId of entry.data.tags) {
    if (seenTags.has(tagId)) {
      throw new Error(`Duplicate moment tag id: ${tagId}`)
    }
    seenTags.add(tagId)
    getTag(tagId)
  }
}

function toTimestamp(entry: MomentEntryLike) {
  return Date.parse(entry.data.publishedAt)
}

export function validateMomentEntries<T extends MomentEntryLike>(entries: readonly T[]): T[] {
  const seenIds = new Set<string>()
  const validated = [...entries]

  for (const entry of validated) {
    assertMomentEntry(entry, seenIds)
  }

  return validated
}

export function sortMoments<T extends MomentEntryLike>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => {
    if (left.data.pinned !== right.data.pinned) {
      return left.data.pinned ? -1 : 1
    }

    const publishedDelta = toTimestamp(right) - toTimestamp(left)
    if (publishedDelta !== 0) return publishedDelta

    return left.data.id.localeCompare(right.data.id)
  })
}

function toMomentView(entry: CollectionEntry<'moments'>): MomentView {
  return {
    entry,
    id: entry.data.id,
    title: entry.data.title,
    publishedAt: new Date(entry.data.publishedAt),
    tags: entry.data.tags.map(getTag),
    pinned: entry.data.pinned,
    contentWarning: entry.data.contentWarning
  }
}

export async function getPublishedMoments(): Promise<MomentView[]> {
  const { getCollection } = await import('astro:content')
  const entries = validateMomentEntries(await getCollection('moments') as CollectionEntry<'moments'>[])
  return sortMoments(entries).map(toMomentView)
}

export async function getMomentById(id: string): Promise<MomentView | undefined> {
  const moments = await getPublishedMoments()
  return moments.find((moment) => moment.id === id)
}

export function toMomentSummary(moment: MomentView, limit = 120): string {
  const summary = (moment.entry.body ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return summary.length > limit ? `${summary.slice(0, limit).trimEnd()}…` : summary
}
