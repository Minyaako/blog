import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MARKER_FILE = '.content-mode'

export function getAstroContentMode(environment = process.env) {
  const postsMode = environment.BLOG_E2E_FIXTURES === 'true' ? 'fixtures' : 'default'
  const momentsMode = environment.BLOG_MOMENT_FIXTURES === 'true' ? 'fixtures' : 'default'
  return `posts=${postsMode};moments=${momentsMode}`
}

export function syncAstroContentCacheMode(rootDir, mode) {
  const astroDir = join(rootDir, '.astro')
  const cacheDir = join(rootDir, 'node_modules', '.astro')
  const markerPath = join(astroDir, MARKER_FILE)
  const previousMode = existsSync(markerPath) ? readFileSync(markerPath, 'utf8') : undefined
  const changed = previousMode !== mode

  if (changed && existsSync(astroDir)) {
    rmSync(astroDir, { recursive: true, force: true })
  }
  if (changed && existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true })
  }

  mkdirSync(astroDir, { recursive: true })
  writeFileSync(markerPath, mode)

  return { changed, mode }
}
