import type { CollectionEntry } from 'astro:content'
import musicLibraryJson from '../content/music/library.json'
import { resolveMedia } from './media'
import { parseMusicLibrary, requireMusicTrack, type MusicLibrary, type MusicTrack } from './music'
import { getTag, type Tag } from './tags'
import { isStrictMomentPublishedAt, MOMENT_ID_PATTERN, type MomentData } from '../schemas/moment'

export interface MomentImageReference {
  media: string
  alt: string
  caption?: string
}

export interface ResolvedMomentImage extends MomentImageReference {
  url: string
  width: number
  height: number
}

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
  images: ResolvedMomentImage[]
  track?: MusicTrack
  pinned: boolean
  contentWarning?: string
}

export function resolveMomentImages(
  images: readonly MomentImageReference[],
): ResolvedMomentImage[] {
  return images.map((image) => {
    const media = resolveMedia(image.media)
    return {
      ...image,
      url: media.url,
      width: media.width,
      height: media.height,
    }
  })
}

function assertMomentEntryId(id: string) {
  if (!MOMENT_ID_PATTERN.test(id)) {
    throw new Error(`Moment entry must use the generated top-level moment id: ${id}`)
  }
  return id
}

function assertMomentEntry(entry: MomentEntryLike, seenIds: Set<string>) {
  const filenameId = assertMomentEntryId(entry.id)

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

const sharedMusicLibrary = parseMusicLibrary(musicLibraryJson)

function toMomentView(entry: CollectionEntry<'moments'>, library: MusicLibrary): MomentView {
  return {
    entry,
    id: entry.data.id,
    title: entry.data.title,
    publishedAt: new Date(entry.data.publishedAt),
    tags: entry.data.tags.map(getTag),
    images: resolveMomentImages(entry.data.images),
    ...(entry.data.track === undefined ? {} : { track: requireMusicTrack(library, entry.data.track, `Moment ${entry.data.id}`) }),
    pinned: entry.data.pinned,
    contentWarning: entry.data.contentWarning
  }
}

export async function getPublishedMoments(
  providedEntries?: readonly MomentEntryLike[],
  providedLibrary: MusicLibrary = sharedMusicLibrary,
): Promise<MomentView[]> {
  const { getCollection } = await import('astro:content')
  const source = providedEntries ?? await getCollection('moments') as CollectionEntry<'moments'>[]
  const entries = validateMomentEntries(source)
  const library = providedEntries ? parseMusicLibrary(providedLibrary) : sharedMusicLibrary
  return sortMoments(entries).map((entry) => toMomentView(entry as CollectionEntry<'moments'>, library))
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
