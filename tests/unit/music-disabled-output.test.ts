import { execFileSync } from 'node:child_process'
import { constants, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const temporaryRoots: string[] = []
const skippedRootEntries = new Set([
  '.astro',
  '.git',
  '.pnpm-store',
  '.superpowers',
  '.ranking-data',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  'tests'
])

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) rmSync(temporaryRoot, { recursive: true, force: true })
}, 60_000)

const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name)
  return entry.isDirectory() ? files(path) : [path]
})

const createDisabledBuildRoot = (): string => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'minyako-blog-music-disabled-'))
  temporaryRoots.push(temporaryRoot)
  cpSync(root, temporaryRoot, {
    recursive: true,
    filter: (source) => {
      const relativePath = relative(root, source)
      if (relativePath === '') return true
      return !skippedRootEntries.has(relativePath.split(sep)[0])
    }
  })
  const libraryPath = join(temporaryRoot, 'src', 'content', 'music', 'library.json')
  const library = JSON.parse(readFileSync(libraryPath, 'utf8')) as Record<string, unknown>
  writeFileSync(libraryPath, JSON.stringify({ ...library, enabled: false }))
  // This tests disabled output, not package installation. Reuse the exact
  // dependency tree already installed by CI; sources, .astro and dist stay isolated.
  if (process.platform === 'win32') {
    symlinkSync(join(root, 'node_modules'), join(temporaryRoot, 'node_modules'), 'junction')
  } else {
    // Astro's Linux compiler requires its .astro components inside the project
    // tree. Preserve pnpm's relative links and clone files without reinstalling.
    cpSync(join(root, 'node_modules'), join(temporaryRoot, 'node_modules'), {
      recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
    })
  }
  return temporaryRoot
}

describe('disabled music player build output', () => {
  it('emits neither player markup nor APlayer client assets for the disabled manifest', () => {
    const buildRoot = createDisabledBuildRoot()
    execFileSync(process.execPath, [join(buildRoot, 'node_modules/astro/bin/astro.mjs'), 'build'], {
      cwd: buildRoot, stdio: 'pipe', timeout: 45_000,
    })
    const pages = files(resolve(buildRoot, 'dist/client')).filter((file) => file.endsWith('.html'))
      .map((file) => readFileSync(file, 'utf8')).join('\n')
    const referencedAssets = [...pages.matchAll(/(?:src|href)="(\/_astro\/[^"\n]+)"/gu)]
      .map((match) => resolve(buildRoot, 'dist/client', `.${match[1]}`))
    const clientOutput = referencedAssets.map((file) => readFileSync(file, 'utf8')).join('\n')

    expect(pages).not.toContain('data-music-player')
    expect(pages).not.toMatch(/(?:MusicPlayer|APlayer|aplayer)/u)
    expect(clientOutput).not.toMatch(/(?:APlayer|\.aplayer)/u)
  }, 60_000)
})
