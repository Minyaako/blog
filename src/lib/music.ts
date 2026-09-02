export interface MusicAsset {
  url: string
  contentType: 'audio/mpeg' | 'text/plain'
  sha256: string
  bytes: number
}

export interface MusicGroup {
  id: string
  label: string
  listed: boolean
  order: number
}

export interface MusicTrack {
  id: string
  groupId: string
  title: string
  artists: string[]
  album?: string
  duration: number
  audio: MusicAsset
  lyrics: MusicAsset | null
}

export interface MusicLibrary {
  version: 1
  enabled: boolean
  groups: MusicGroup[]
  tracks: MusicTrack[]
}

export interface PlayerTrack extends MusicTrack {
  lrcText: string | null
}

export interface MusicPlayerModel {
  visibleGroups: MusicGroup[]
  initialTracks: PlayerTrack[]
  allTracks: PlayerTrack[]
}

export class MusicLibraryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicLibraryError'
  }
}

const MAX_LRC_BYTES = 256 * 1024
const hashPattern = /^[a-f0-9]{64}$/
const groupIdPattern = /^\d+$/
const lyricCache = new Map<string, Promise<string>>()

const asObject = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new MusicLibraryError(`${path} must be an object.`)
  return value as Record<string, unknown>
}

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], path: string): void => {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some((key) => !expected.includes(key))) {
    throw new MusicLibraryError(`${path} contains unknown or missing fields.`)
  }
}

const nonEmptyText = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new MusicLibraryError(`${path} must be a non-empty string.`)
  return value
}

const positiveNumber = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new MusicLibraryError(`${path} must be a positive number.`)
  return value
}

const positiveInteger = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new MusicLibraryError(`${path} must be a positive integer.`)
  return value
}

function parseAsset(input: unknown, expectedType: MusicAsset['contentType'], path: string): MusicAsset {
  const value = asObject(input, path)
  exactKeys(value, ['url', 'contentType', 'sha256', 'bytes'], path)
  const sha256 = nonEmptyText(value.sha256, `${path}.sha256`)
  if (!hashPattern.test(sha256)) throw new MusicLibraryError(`${path}.sha256 must be a lowercase SHA-256 digest.`)
  if (value.contentType !== expectedType) throw new MusicLibraryError(`${path}.contentType is invalid.`)
  const kind = expectedType === 'audio/mpeg' ? 'audio' : 'lyrics'
  const extension = expectedType === 'audio/mpeg' ? 'mp3' : 'lrc'
  const expectedUrl = `https://pic.minyako.top/blog/music/${kind}/${sha256.slice(0, 2)}/${sha256}.${extension}`
  if (value.url !== expectedUrl) throw new MusicLibraryError(`${path}.url must be the immutable music CDN path.`)
  return { url: value.url, contentType: expectedType, sha256, bytes: positiveInteger(value.bytes, `${path}.bytes`) }
}

export function parseMusicLibrary(input: unknown): MusicLibrary {
  const value = asObject(input, 'music library')
  exactKeys(value, ['version', 'enabled', 'groups', 'tracks'], 'music library')
  if (value.version !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.groups) || !Array.isArray(value.tracks)) {
    throw new MusicLibraryError('music library header is invalid.')
  }

  const groupIds = new Set<string>()
  const groups = value.groups.map((input, index) => {
    const path = `groups[${index}]`
    const group = asObject(input, path)
    exactKeys(group, ['id', 'label', 'listed', 'order'], path)
    const id = nonEmptyText(group.id, `${path}.id`)
    if (!groupIdPattern.test(id) || groupIds.has(id)) throw new MusicLibraryError(`${path}.id must be a unique numeric string.`)
    if (typeof group.listed !== 'boolean') throw new MusicLibraryError(`${path}.listed must be a boolean.`)
    if (typeof group.order !== 'number' || !Number.isSafeInteger(group.order) || group.order < 0) throw new MusicLibraryError(`${path}.order must be a non-negative integer.`)
    if (id === '0' && group.listed) throw new MusicLibraryError(`${path}.listed must be false for hidden group 0.`)
    groupIds.add(id)
    return { id, label: nonEmptyText(group.label, `${path}.label`), listed: group.listed, order: group.order }
  })

  const trackIds = new Set<string>()
  const tracks = value.tracks.map((input, index) => {
    const path = `tracks[${index}]`
    const track = asObject(input, path)
    const expected = typeof track.album === 'undefined'
      ? ['id', 'groupId', 'title', 'artists', 'duration', 'audio', 'lyrics']
      : ['id', 'groupId', 'title', 'artists', 'album', 'duration', 'audio', 'lyrics']
    exactKeys(track, expected, path)
    const id = nonEmptyText(track.id, `${path}.id`)
    const groupId = nonEmptyText(track.groupId, `${path}.groupId`)
    if (trackIds.has(id)) throw new MusicLibraryError(`${path}.id must be unique.`)
    if (!groupIds.has(groupId)) throw new MusicLibraryError(`${path}.groupId must reference an existing group.`)
    if (!Array.isArray(track.artists) || track.artists.length === 0) throw new MusicLibraryError(`${path}.artists must contain at least one artist.`)
    if (typeof track.album !== 'undefined' && (typeof track.album !== 'string' || track.album.trim() === '')) throw new MusicLibraryError(`${path}.album must be a non-empty string.`)
    trackIds.add(id)
    return {
      id,
      groupId,
      title: nonEmptyText(track.title, `${path}.title`),
      artists: track.artists.map((artist, artistIndex) => nonEmptyText(artist, `${path}.artists[${artistIndex}]`)),
      ...(typeof track.album === 'undefined' ? {} : { album: track.album }),
      duration: positiveNumber(track.duration, `${path}.duration`),
      audio: parseAsset(track.audio, 'audio/mpeg', `${path}.audio`),
      lyrics: track.lyrics === null ? null : parseAsset(track.lyrics, 'text/plain', `${path}.lyrics`),
    }
  })
  return { version: 1, enabled: value.enabled, groups, tracks }
}

async function readBoundedUtf8(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_LRC_BYTES)) throw new Error('lyric is larger than 256 KiB')
  if (!response.body) return new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_LRC_BYTES) {
      await reader.cancel()
      throw new Error('lyric is larger than 256 KiB')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function loadLyrics(track: MusicTrack, fetchImpl: typeof fetch, cache: Map<string, Promise<string>>): Promise<string | null> {
  if (track.lyrics === null) return null
  const { url } = track.lyrics
  const task = cache.get(url) ?? Promise.resolve(fetchImpl(url)).then(readBoundedUtf8)
  cache.set(url, task)
  try {
    return await task
  } catch (error) {
    cache.delete(url)
    throw new MusicLibraryError(`track ${track.id} lyrics failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
}

export async function buildMusicPlayerModel(library: MusicLibrary, fetchImpl: typeof fetch = fetch): Promise<MusicPlayerModel> {
  const parsed = parseMusicLibrary(library)
  const cache = fetchImpl === fetch ? lyricCache : new Map<string, Promise<string>>()
  const allTracks = await Promise.all(parsed.tracks.map(async (track) => ({ ...track, lrcText: await loadLyrics(track, fetchImpl, cache) })))
  const visibleGroups = parsed.groups.filter((group) => group.listed).sort((left, right) => left.order - right.order)
  const visibleIds = new Set(visibleGroups.map((group) => group.id))
  return { visibleGroups, initialTracks: allTracks.filter((track) => visibleIds.has(track.groupId)), allTracks }
}

export const shouldRenderMusicPlayer = (library: MusicLibrary): boolean => parseMusicLibrary(library).enabled
