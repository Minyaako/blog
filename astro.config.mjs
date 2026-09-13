import mdx from '@astrojs/mdx'
import { unified } from '@astrojs/markdown-remark'
import {
  transformerMetaHighlight,
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerRemoveLineBreak
} from '@shikijs/transformers'
import { defineConfig, sessionDrivers } from 'astro/config'
import node from '@astrojs/node'
import icon from 'astro-icon'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { transformerCodePanel } from './src/lib/code-panel-transformer.mjs'
import { musicModelPlugin } from './scripts/music-model-plugin.mjs'
import rehypeLinkCards from './src/lib/rehype-link-cards.mjs'

export default defineConfig({
  site: 'https://gsk.minyako.top',
  output: 'static',
  // Authentication uses SQLite sessions; avoid the adapter's unused filesystem store.
  session: { driver: sessionDrivers.memory() },
  adapter: node({ mode: 'standalone', bodySizeLimit: 256 * 1024, staticHeaders: true }),
  trailingSlash: 'always',
  vite: { plugins: [musicModelPlugin()] },
  integrations: [
    mdx(),
    icon({
      include: {
        lucide: ['archive', 'book-open', 'book-open-check', 'cpu', 'coffee', 'gamepad-2', 'chevron-down', 'chevron-up', 'external-link', 'house', 'moon', 'music-2', 'panel-right-close', 'panel-right-open', 'pause', 'play', 'rss', 'search', 'shapes', 'skip-back', 'skip-forward', 'sun', 'tags', 'volume-2'],
        'simple-icons': ['github']
      }
    })
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex, rehypeLinkCards]
    }),
    shikiConfig: {
      themes: {
        light: 'github-light-high-contrast',
        dark: 'github-dark-high-contrast'
      },
      transformers: [
        transformerMetaHighlight(),
        transformerNotationHighlight({ matchAlgorithm: 'v3' }),
        transformerNotationDiff({ matchAlgorithm: 'v3' }),
        transformerRemoveLineBreak(),
        transformerCodePanel()
      ]
    }
  }
})
