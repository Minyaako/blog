import mediaLock from '../../media/media.lock.json'

export type MediaId = string

export type LockedMedia = {
  id: string
  url: string
  width: number
  height: number
  contentType: 'image/webp'
}

type LockEntry = Omit<LockedMedia, 'contentType'> & { contentType: string }

export type MediaReference = {
  media: string
  alt: string
  credit: string
  sourceUrl?: string
}

export type ResolvedCover = Omit<MediaReference, 'media'> & LockedMedia

export function createMediaResolver(assets: readonly LockEntry[]): (id: string) => LockedMedia {
  const byId = new Map<string, LockedMedia>()
  for (const asset of assets) {
    if (byId.has(asset.id)) throw new Error(`Duplicate media id: ${asset.id}`)
    if (!asset.url.startsWith('https://pic.minyako.top/blog/')) {
      throw new Error(`Invalid media URL for ${asset.id}`)
    }
    if (asset.contentType !== 'image/webp') {
      throw new Error(`Unsupported media type for ${asset.id}: ${asset.contentType}`)
    }
    if (!Number.isSafeInteger(asset.width) || asset.width <= 0 ||
        !Number.isSafeInteger(asset.height) || asset.height <= 0) {
      throw new Error(`Invalid media dimensions for ${asset.id}`)
    }

    byId.set(asset.id, {
      id: asset.id,
      url: asset.url,
      width: asset.width,
      height: asset.height,
      contentType: asset.contentType
    })
  }

  return (id: string) => {
    const media = byId.get(id)
    if (!media) throw new Error(`Unknown media id: ${id}`)
    return media
  }
}

const resolveCommittedMedia = createMediaResolver(mediaLock.assets)

export function resolveMedia(id: string): LockedMedia {
  return resolveCommittedMedia(id)
}

export function resolveCover(reference: MediaReference): ResolvedCover {
  const { media, ...editorial } = reference
  return { ...resolveMedia(media), ...editorial }
}
