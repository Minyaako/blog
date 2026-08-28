import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { getAstroContentMode, syncAstroContentCacheMode } from './lib/astro-content-cache.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const mode = getAstroContentMode(process.env)

syncAstroContentCacheMode(rootDir, mode)
