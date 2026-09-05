import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const runPnpm = (cwd: string, args: string[]): void => {
  const command: [string, string[]] = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`]]
    : ['pnpm', args]
  execFileSync(command[0], command[1], { cwd, stdio: 'pipe' })
}

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
  writeFileSync(join(temporaryRoot, 'src', 'content', 'music', 'library.json'), JSON.stringify({
    version: 1,
    enabled: false,
    groups: [],
    tracks: []
  }))
  return temporaryRoot
}

describe('disabled music player build output', () => {
  it('emits neither player markup nor APlayer client assets for the disabled manifest', () => {
    const buildRoot = createDisabledBuildRoot()
    runPnpm(buildRoot, ['install', '--prefer-offline', '--frozen-lockfile', '--ignore-scripts'])
    runPnpm(buildRoot, ['exec', 'astro', 'build'])
    const pages = files(resolve(buildRoot, 'dist')).filter((file) => file.endsWith('.html'))
      .map((file) => readFileSync(file, 'utf8')).join('\n')
    const referencedAssets = [...pages.matchAll(/(?:src|href)="(\/_astro\/[^"\n]+)"/gu)]
      .map((match) => resolve(buildRoot, 'dist', `.${match[1]}`))
    const clientOutput = referencedAssets.map((file) => readFileSync(file, 'utf8')).join('\n')

    expect(pages).not.toContain('data-music-player')
    expect(pages).not.toMatch(/(?:MusicPlayer|APlayer|aplayer)/u)
    expect(clientOutput).not.toMatch(/(?:APlayer|\.aplayer)/u)
  }, 60_000)
})
