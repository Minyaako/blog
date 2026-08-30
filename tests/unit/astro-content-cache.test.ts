import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { getAstroContentMode, syncAstroContentCacheMode } from '../../scripts/lib/astro-content-cache.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'astro-content-cache-'))
  roots.push(root)
  return root
}

describe('syncAstroContentCacheMode', () => {
  it('gives empty content its own cache mode before populated fixture modes', () => {
    expect(getAstroContentMode({
      BLOG_E2E_EMPTY_CONTENT: 'true',
      BLOG_E2E_FIXTURES: 'true',
      BLOG_MOMENT_FIXTURES: 'true',
    })).toBe('posts=empty;moments=empty')
  })

  it('clears stale Astro content artifacts when switching between fixture and default content modes', () => {
    const root = makeRoot()
    const astroDir = join(root, '.astro')
    const cacheDir = join(root, 'node_modules', '.astro')
    mkdirSync(astroDir, { recursive: true })
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(astroDir, '.content-mode'), 'posts=fixtures;moments=fixtures')
    writeFileSync(join(astroDir, 'content-modules.mjs'), 'stale-fixture-entry')
    writeFileSync(join(cacheDir, 'data-store.json'), 'stale-fixture-store')

    const result = syncAstroContentCacheMode(root, 'posts=default;moments=default')

    expect(result).toEqual({ changed: true, mode: 'posts=default;moments=default' })
    expect(() => readFileSync(join(astroDir, 'content-modules.mjs'), 'utf8')).toThrow()
    expect(() => readFileSync(join(cacheDir, 'data-store.json'), 'utf8')).toThrow()
    expect(readFileSync(join(astroDir, '.content-mode'), 'utf8')).toBe('posts=default;moments=default')
  })

  it('keeps Astro content artifacts when the content mode did not change', () => {
    const root = makeRoot()
    const astroDir = join(root, '.astro')
    mkdirSync(astroDir, { recursive: true })
    writeFileSync(join(astroDir, '.content-mode'), 'posts=fixtures;moments=fixtures')
    writeFileSync(join(astroDir, 'content-modules.mjs'), 'still-valid')

    const result = syncAstroContentCacheMode(root, 'posts=fixtures;moments=fixtures')

    expect(result).toEqual({ changed: false, mode: 'posts=fixtures;moments=fixtures' })
    expect(readFileSync(join(astroDir, 'content-modules.mjs'), 'utf8')).toBe('still-valid')
  })
})
