import { describe, expect, it } from 'vitest'
import {
  buildMusicPlayerModel,
  parseMusicLibrary,
  shouldRenderMusicPlayer,
  type MusicAsset,
  type MusicLibrary,
} from '../../src/lib/music'

const hash = (character: string) => character.repeat(64)
const asset = (kind: 'audio' | 'lyrics', character: string, bytes = 128): MusicAsset => {
  const sha256 = hash(character)
  const extension = kind === 'audio' ? 'mp3' : 'lrc'
  const contentType = kind === 'audio' ? 'audio/mpeg' : 'text/plain'
  return {
    url: `https://pic.minyako.top/blog/music/${kind}/${sha256.slice(0, 2)}/${sha256}.${extension}`,
    contentType,
    sha256,
    bytes,
  }
}

const library: MusicLibrary = {
  version: 1,
  enabled: true,
  groups: [
    { id: '0', label: '隐藏', listed: false, order: 0 },
    { id: '1', label: '公开', listed: true, order: 1 },
  ],
  tracks: [
    {
      id: 'hidden-track', groupId: '0', title: 'Hidden', artists: ['Artist'], duration: 180,
      audio: asset('audio', 'a'), lyrics: asset('lyrics', 'b'),
    },
    {
      id: 'no-lyrics', groupId: '1', title: 'Visible', artists: ['Artist'], duration: 181,
      audio: asset('audio', 'c'), lyrics: null,
    },
  ],
}

const coverHash = hash('d')
const cover = {
  sourceImageId: 'img_coverSource123',
  url: `https://pic.minyako.top/blog/music/covers/${coverHash.slice(0, 2)}/${coverHash}.webp`,
  contentType: 'image/webp' as const,
  sha256: coverHash,
  width: 800 as const,
  height: 800 as const,
  bytes: 12345,
}

const renderWith = async (value: MusicLibrary) => shouldRenderMusicPlayer(value)
  ? '<aside data-music-player></aside>'
  : ''

const lyricFetch: typeof fetch = async () => new Response('[00:00.00]歌词', {
  status: 200,
  headers: { 'content-length': '18' },
})

describe('music player model', () => {
  it('accepts version 1 tracks with an optional immutable cover', () => {
    const libraryWithCover = {
      ...library,
      tracks: [{ ...library.tracks[0], cover }],
    }

    expect(parseMusicLibrary(libraryWithCover).tracks[0].cover).toEqual(cover)
  })

  it('keeps existing coverless version 1 tracks valid', () => {
    expect(parseMusicLibrary(library).tracks[0].cover).toBeUndefined()
  })

  it.each([
    ['wrong origin', { ...cover, url: `https://example.com/blog/music/covers/${coverHash.slice(0, 2)}/${coverHash}.webp` }],
    ['wrong path', { ...cover, url: `https://pic.minyako.top/blog/music/covers/ff/${coverHash}.webp` }],
    ['wrong MIME', { ...cover, contentType: 'image/png' }],
    ['wrong digest', { ...cover, sha256: 'not-a-digest' }],
    ['wrong dimensions', { ...cover, width: 799 }],
    ['extra cover keys', { ...cover, extra: true }],
  ])('rejects a cover with %s', (_reason, invalidCover) => {
    expect(() => parseMusicLibrary({
      ...library,
      tracks: [{ ...library.tracks[0], cover: invalidCover }],
    })).toThrow(/cover/i)
  })

  it('hides a disabled player and keeps hidden tracks searchable but out of startup playback', async () => {
    const model = await buildMusicPlayerModel(library, lyricFetch)
    const hiddenTrack = library.tracks[0]
    const noLyrics = library.tracks[1]

    expect(await renderWith({ ...library, enabled: false })).not.toContain('data-music-player')
    expect(model.visibleGroups.every((group) => group.listed)).toBe(true)
    expect(model.initialTracks.map((track) => track.id)).not.toContain(hiddenTrack.id)
    expect(model.allTracks.map((track) => track.id)).toContain(hiddenTrack.id)
    expect(model.allTracks.find((track) => track.id === noLyrics.id)?.lrcText).toBeNull()
  })

  it('rejects malformed immutable assets with a useful field path', () => {
    expect(() => parseMusicLibrary({
      ...library,
      tracks: [{ ...library.tracks[0], audio: { ...library.tracks[0].audio, url: 'https://example.com/song.mp3' } }],
    })).toThrow(/tracks\[0\]\.audio\.url/)
    expect(() => parseMusicLibrary({
      ...library,
      tracks: [{ ...library.tracks[0], audio: { ...library.tracks[0].audio, sha256: 'bad' } }],
    })).toThrow(/tracks\[0\]\.audio\.sha256/)
  })

  it.each([
    ['cannot be fetched', async () => new Response('missing', { status: 404 })],
    ['is not fatal UTF-8', async () => new Response(new Uint8Array([0xc3, 0x28]), { status: 200 })],
    ['exceeds 256 KiB', async () => new Response(new Uint8Array(256 * 1024 + 1), { status: 200 })],
  ])('rejects a declared LRC that %s with its track id', async (_reason, fetchImpl) => {
    await expect(buildMusicPlayerModel(library, fetchImpl as typeof fetch)).rejects.toThrow(/hidden-track/)
  })
})
