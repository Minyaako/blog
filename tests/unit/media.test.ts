import { describe, expect, it } from 'vitest'
import mediaLock from '../../media/media.lock.json'
import { resolveCover, resolveMedia } from '../../src/lib/media'

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
})
