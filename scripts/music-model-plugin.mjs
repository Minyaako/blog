import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { buildMusicPlayerModel, parseMusicLibrary, shouldRenderMusicPlayer } from '../src/lib/music.ts'

// Embed lyrics at compilation so SSR never depends on the media host being online.
export function musicModelPlugin() {
  const id = 'virtual:blog-music-model'
  const resolvedId = `\0${id}`
  const libraryPath = fileURLToPath(new URL('../src/content/music/library.json', import.meta.url))
  return {
    name: 'blog-music-model',
    resolveId(source) { if (source === id) return resolvedId },
    async load(source) {
      if (source !== resolvedId) return
      this.addWatchFile(libraryPath)
      const library = parseMusicLibrary(JSON.parse(await readFile(libraryPath, 'utf8')))
      const model = shouldRenderMusicPlayer(library) ? await buildMusicPlayerModel(library) : null
      return `export default ${JSON.stringify(model)}`
    }
  }
}
