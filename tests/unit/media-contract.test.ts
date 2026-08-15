import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const read = (path: string) => readFileSync(path, 'utf8')

describe('media publishing contract', () => {
  it('pins the shared publisher and records seven immutable CDN objects', () => {
    const pkg = JSON.parse(read('package.json'))
    const manifest = parse(read('media/media.yaml'))
    const lock = JSON.parse(read('media/media.lock.json'))
    const dockerIgnore = read('.dockerignore')

    expect(pkg.devDependencies['@minyaako/media-publisher'])
      .toBe('github:Minyaako/media-publisher#ededa7f0af445f568b4954cac25408288cac5f05')
    expect(pkg.scripts['media:verify'])
      .toBe('media-publisher verify --lock media/media.lock.json --all')
    expect(manifest.assets).toHaveLength(7)
    expect(lock.assets).toHaveLength(7)
    expect(new Set(lock.assets.map((asset: { id: string }) => asset.id)).size).toBe(7)
    expect(lock.assets.every((asset: { url: string }) =>
      asset.url.startsWith('https://pic.minyako.top/blog/'))).toBe(true)
    expect(dockerIgnore.split(/\r?\n/)).toContain('media/assets')
  })
})
