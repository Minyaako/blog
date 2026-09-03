import { describe, expect, it, vi } from 'vitest'

const { mockGetCollection } = vi.hoisted(() => ({
  mockGetCollection: vi.fn()
}))

vi.mock('astro:content', () => ({
  getCollection: mockGetCollection
}))

import { getPublishedMoments, resolveMomentImages, sortMoments, validateMomentEntries } from '../../src/lib/moments'
import type { MusicLibrary } from '../../src/lib/music'

const baseMoment = {
  id: '20260823-143501-a7c31e4f',
  publishedAt: '2026-08-23T14:35:01+08:00',
  tags: ['life-notes'],
  images: [],
  track: undefined as string | undefined,
  pinned: false
}

const entry = (
  filename: string,
  overrides: Partial<typeof baseMoment> = {},
  body = '正文'
) => ({
  id: filename,
  body,
  data: { ...baseMoment, ...overrides }
})

const hash = 'a'.repeat(64)
const library: MusicLibrary = {
  version: 1,
  enabled: true,
  groups: [{ id: '0', label: '隐藏歌单', listed: false, order: 0 }],
  tracks: [{
    id: 'track_hidden', groupId: '0', title: '隐藏曲目', artists: ['歌手'], duration: 180,
    audio: { url: `https://pic.minyako.top/blog/music/audio/${hash.slice(0, 2)}/${hash}.mp3`, contentType: 'audio/mpeg', sha256: hash, bytes: 1 },
    lyrics: null,
  }],
}

describe('moment collection adapter', () => {
  it('resolves a Moment track into view data', async () => {
    await expect(getPublishedMoments([
      entry('20260823-143501-a7c31e4f', { track: 'track_hidden' })
    ], library)).resolves.toMatchObject([{ track: { id: 'track_hidden', title: '隐藏曲目' } }])
  })

  it('rejects a Moment that references a missing track with both ids', async () => {
    await expect(getPublishedMoments([
      entry('20260823-143501-a7c31e4f', { track: 'track_missing' })
    ], library)).rejects.toThrow(/20260823-143501-a7c31e4f.*track_missing/i)
  })

  it('resolves structured image references through the committed media registry', () => {
    expect(resolveMomentImages([
      { media: 'home-hero-01', alt: '示例' }
    ])[0]).toMatchObject({
      media: 'home-hero-01',
      alt: '示例',
      url: expect.stringMatching(/^https:\/\//),
      width: expect.any(Number),
      height: expect.any(Number)
    })
  })

  it('fails closed when a Moment image references an unknown media id', () => {
    expect(() => resolveMomentImages([
      { media: 'not-registered', alt: '示例' }
    ])).toThrow(/Unknown media id: not-registered/)
  })

  it('sorts pinned moments ahead of newer unpinned ones', () => {
    const moments = sortMoments([
      entry('20260823-143501-a7c31e4f'),
      entry('20260824-143501-a7c31e4f', {
        id: '20260824-143501-a7c31e4f',
        publishedAt: '2026-08-24T14:35:01+08:00'
      }),
      entry('20260822-143501-a7c31e4f', {
        id: '20260822-143501-a7c31e4f',
        publishedAt: '2026-08-22T14:35:01+08:00',
        pinned: true
      })
    ])

    expect(moments.map((moment) => moment.data.id)).toEqual([
      '20260822-143501-a7c31e4f',
      '20260824-143501-a7c31e4f',
      '20260823-143501-a7c31e4f'
    ])
  })

  it('sorts by absolute publish time across different offsets', () => {
    const moments = sortMoments([
      entry('20260823-143501-a7c31e4f', {
        publishedAt: '2026-08-23T14:35:01+08:00'
      }),
      entry('20260823-143502-a7c31e4f', {
        id: '20260823-143502-a7c31e4f',
        publishedAt: '2026-08-23T03:00:00-04:00'
      })
    ])

    expect(moments.map((moment) => moment.data.id)).toEqual([
      '20260823-143502-a7c31e4f',
      '20260823-143501-a7c31e4f'
    ])
  })

  it('uses the stable id as the final tie-breaker', () => {
    const moments = sortMoments([
      entry('20260823-143501-bbbbbbbb', {
        id: '20260823-143501-bbbbbbbb'
      }),
      entry('20260823-143501-aaaaaaaa', {
        id: '20260823-143501-aaaaaaaa'
      })
    ])

    expect(moments.map((moment) => moment.data.id)).toEqual([
      '20260823-143501-aaaaaaaa',
      '20260823-143501-bbbbbbbb'
    ])
  })

  it('rejects duplicate ids before publishing', () => {
    expect(() => validateMomentEntries([
      entry('20260823-143501-a7c31e4f'),
      entry('20260823-143501-a7c31e4f')
    ])).toThrow(/duplicate/i)
  })

  it.each([
    'nested/20260823-143501-a7c31e4f.mdx',
    '20260823-143501-a7c31e4f.md',
    'bad-id.mdx',
  ])('rejects any moment entry outside the exact top-level mdx contract: %s', (filename) => {
    expect(() => validateMomentEntries([
      entry(filename)
    ])).toThrow(/top-level|id/i)
  })

  it.each([
    '2026-02-29T14:35:01+08:00',
    '2026-02-30T14:35:01+08:00',
    '2026-04-31T14:35:01+08:00',
    '2026-08-23T24:00:00+08:00',
    '2026-08-23T14:35:01+14:30',
    '2026-08-23T14:35:01+15:00',
    '2026-08-23T14:35:01+23:59',
  ])('fails closed on an invalid moment timestamp even if the collection loader yields it: %s', (publishedAt) => {
    expect(() => validateMomentEntries([
      entry('20260823-143501-a7c31e4f', {
        publishedAt,
      })
    ])).toThrow(/publishedAt|time zone|calendar/i)
  })

  it('rejects unknown tags before publishing', () => {
    expect(() => validateMomentEntries([
      entry('20260823-143501-a7c31e4f', {
        tags: ['missing-tag']
      })
    ])).toThrow(/Unknown tag: missing-tag/)
  })

  it('rejects duplicate tag ids before publishing', () => {
    expect(() => validateMomentEntries([
      entry('20260823-143501-a7c31e4f', {
        tags: ['life-notes', 'life-notes']
      })
    ])).toThrow(/Duplicate moment tag id: life-notes/)
  })

  it('returns an empty list when the collection is empty instead of falling back to sample moments', async () => {
    mockGetCollection.mockResolvedValueOnce([])

    await expect(getPublishedMoments()).resolves.toEqual([])
  })

  it('accepts real collection entry ids from the configured Astro moments loader instead of requiring a .mdx suffix', async () => {
    mockGetCollection.mockResolvedValueOnce([
      entry('20260823-143501-a7c31e4f')
    ])

    await expect(getPublishedMoments()).resolves.toMatchObject([
      {
        id: '20260823-143501-a7c31e4f',
      }
    ])
  })

  it('throws when the collection contains an invalid moment instead of silently dropping it', async () => {
    mockGetCollection.mockResolvedValueOnce([
      entry('20260823-143501-a7c31e4f'),
      entry('20260823-143502-a7c31e4f', {
        id: '20260823-143502-a7c31e4f',
        tags: ['missing-tag']
      })
    ])

    await expect(getPublishedMoments()).rejects.toThrow(/Unknown tag: missing-tag/)
  })

  it('throws when the collection yields a nested or markdown moment entry instead of silently accepting it', async () => {
    mockGetCollection.mockResolvedValueOnce([
      entry('nested/20260823-143501-a7c31e4f.mdx'),
      entry('20260823-143502-a7c31e4f.md', {
        id: '20260823-143502-a7c31e4f',
      })
    ])

    await expect(getPublishedMoments()).rejects.toThrow(/top-level|id/i)
  })
})
