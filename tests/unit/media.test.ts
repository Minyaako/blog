import { describe, expect, it } from 'vitest'
import mediaLock from '../../media/media.lock.json'
import { createMediaResolver, resolveCover, resolveMedia } from '../../src/lib/media'

const hostedSha = 'ab'.repeat(32)

describe('locked media resolver', () => {
  it('resolves every logical id from the committed lock', () => {
    for (const asset of mediaLock.assets) {
      expect(resolveMedia(asset.id)).toEqual({
        id: asset.id,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        contentType: 'image/webp'
      })
    }
  })

  it('serves only HTTPS WebP objects below the blog prefix', () => {
    for (const asset of mediaLock.assets) {
      const resolved = resolveMedia(asset.id)
      expect(resolved.url).toMatch(/^https:\/\/pic\.minyako\.top\/blog\//)
      expect(resolved.contentType).toBe('image/webp')
      expect(resolved.width).toBeGreaterThan(0)
      expect(resolved.height).toBeGreaterThan(0)
    }
  })

  it('combines locked delivery data with editorial cover metadata', () => {
    expect(resolveCover({
      media: 'post-engineering-cover',
      alt: 'Engineering cover',
      credit: 'Minyako'
    })).toMatchObject({
      id: 'post-engineering-cover',
      alt: 'Engineering cover',
      credit: 'Minyako'
    })
  })

  it('rejects an unknown logical id', () => {
    expect(() => resolveMedia('missing-cover')).toThrow('Unknown media id: missing-cover')
  })

  it('resolves a hosted fixture with the same public shape while all seven legacy values stay unchanged', () => {
    const legacyBefore = mediaLock.assets.map((asset) => resolveMedia(asset.id))
    const hosted = {
      id: 'hosted-cover',
      mode: 'hosted' as const,
      provider: 'minyako-image' as const,
      providerId: 'img_AAAAAAAAAAAAAAAAAAAAAAAA',
      sha256: hostedSha,
      bytes: 123,
      contentType: 'image/webp' as const,
      width: 12,
      height: 8,
      frames: 1 as const,
      url: `https://pic.minyako.top/blog/ab/${hostedSha}.webp`,
      createdAt: '2026-08-15T00:00:00.000Z'
    }
    const mixed = createMediaResolver([...mediaLock.assets, hosted])

    expect(mixed('hosted-cover')).toEqual({
      id: 'hosted-cover',
      url: `https://pic.minyako.top/blog/ab/${hostedSha}.webp`,
      width: 12,
      height: 8,
      contentType: 'image/webp'
    })
    expect(mediaLock.assets.map((asset) => mixed(asset.id))).toEqual(legacyBefore)
  })
})
