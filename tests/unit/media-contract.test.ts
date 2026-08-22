import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path: string) => readFileSync(path, 'utf8')

interface HostedManifestEntry {
  id: string
  mode: 'hosted'
  provider: string
  providerId: string
}

interface HostedLockEntry extends HostedManifestEntry {
  sha256: string
  url: string
  width: number
  height: number
}

describe('media publishing contract', () => {
  it('pins the shared publisher and preserves the exact legacy object identities', () => {
    const pkg = JSON.parse(read('package.json'))
    const manifest = parse(read('media/media.yaml'))
    const lock = JSON.parse(read('media/media.lock.json'))
    const dockerIgnore = read('.dockerignore')
    const expectedLegacy = [
      ['home-hero-01', 'faf4361e6b8c0276daaab9c0f0190d4362968dc6958e61bb6ebd5441cf230329'],
      ['home-hero-02', '809007593f410aba1886c15eab6df61c239c6314f12b1ddb3835995706f18f3b'],
      ['post-academic-cover', 'f03e8a61960275abdd4255138e3e8a5fd471251cefb47024dba6313b04ae5fe2'],
      ['post-engineering-cover', '619fe237155b1700a886e06d1da193f81f9c7041c38f101422562cf59547eadc'],
      ['post-games-cover', '25ca0d1e0bb72d75603f7f42a50cfb48df6d4e9cd6bd055a7891ca40b89e274d'],
      ['post-life-cover', 'ff5fbec3339faa8a135d735b170515fd0f10313428c29eeb81121ac0205b57ae'],
      ['profile-avatar', '6f5db833ad02f4d0c0db3eef6fe866d4dfb9c44791a11c41cd32a87ad7268bf1']
    ]

    expect(pkg.devDependencies['@minyaako/media-publisher'])
      .toBe('github:Minyaako/media-publisher#ededa7f0af445f568b4954cac25408288cac5f05')
    expect(pkg.scripts['media:verify'])
      .toBe('media-publisher verify --lock media/media.lock.json --all')
    expect(manifest.assets.filter((asset: { mode?: string }) => asset.mode !== 'hosted').map((asset: { id: string }) => asset.id).sort())
      .toEqual(expectedLegacy.map(([id]) => id).sort())
    expect(lock.assets.filter((asset: { mode?: string }) => asset.mode !== 'hosted').map((asset: { id: string, sha256: string }) => [asset.id, asset.sha256]).sort())
      .toEqual(expectedLegacy.sort())
    expect(new Set(lock.assets.map((asset: { id: string }) => asset.id)).size)
      .toBe(lock.assets.length)
    expect(lock.assets.every((asset: { url: string }) =>
      asset.url.startsWith('https://pic.minyako.top/blog/'))).toBe(true)
    expect(dockerIgnore.split(/\r?\n/)).toContain('media/assets')
  })

  it('validates every editor-hosted image without pinning the content inventory', () => {
    const manifest = parse(read('media/media.yaml'))
    const lock = JSON.parse(read('media/media.lock.json'))
    const hostedManifest = manifest.assets.filter((asset: { mode?: string }) => asset.mode === 'hosted') as HostedManifestEntry[]
    const hostedLock = lock.assets.filter((asset: { mode?: string }) => asset.mode === 'hosted') as HostedLockEntry[]
    const lockById = new Map(hostedLock.map((asset) => [asset.id, asset]))

    expect(hostedLock.map((asset: { id: string }) => asset.id).sort())
      .toEqual(hostedManifest.map((asset: { id: string }) => asset.id).sort())
    for (const manifestEntry of hostedManifest) {
      const lockEntry = lockById.get(manifestEntry.id)
      expect(lockEntry).toBeDefined()
      if (!lockEntry) continue
      expect(manifestEntry).toMatchObject({ mode: 'hosted', provider: 'minyako-image' })
      expect(manifestEntry.providerId).toMatch(/^img_[A-Za-z0-9]{24}$/)
      expect(lockEntry).toMatchObject({
        mode: 'hosted',
        provider: manifestEntry.provider,
        providerId: manifestEntry.providerId
      })
      expect(lockEntry.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(lockEntry.url).toMatch(/^https:\/\/pic\.minyako\.top\/blog\/[a-f0-9]{2}\/[a-f0-9]{64}\.webp$/)
      expect(lockEntry.width).toBeGreaterThan(0)
      expect(lockEntry.height).toBeGreaterThan(0)
      expect(manifestEntry).not.toHaveProperty('file')
      expect(manifestEntry).not.toHaveProperty('objectKey')
      expect(lockEntry).not.toHaveProperty('file')
      expect(lockEntry).not.toHaveProperty('objectKey')
    }
  })
})
