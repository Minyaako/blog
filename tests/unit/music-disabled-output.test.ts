import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name)
  return entry.isDirectory() ? files(path) : [path]
})

describe('disabled music player build output', () => {
  it('emits neither player markup nor APlayer client assets for the disabled manifest', () => {
    const command: [string, string[]] = process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm exec astro build']]
      : ['pnpm', ['exec', 'astro', 'build']]
    execFileSync(command[0], command[1], { cwd: root, stdio: 'pipe' })
    const pages = files(resolve(root, 'dist')).filter((file) => file.endsWith('.html'))
      .map((file) => readFileSync(file, 'utf8')).join('\n')
    const referencedAssets = [...pages.matchAll(/(?:src|href)="(\/_astro\/[^"\n]+)"/gu)]
      .map((match) => resolve(root, 'dist', `.${match[1]}`))
    const clientOutput = referencedAssets.map((file) => readFileSync(file, 'utf8')).join('\n')

    expect(pages).not.toContain('data-music-player')
    expect(pages).not.toMatch(/(?:MusicPlayer|APlayer|aplayer)/u)
    expect(clientOutput).not.toMatch(/(?:APlayer|\.aplayer)/u)
  }, 30_000)
})
