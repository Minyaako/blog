import mdx from '@astrojs/mdx'
import { unified } from '@astrojs/markdown-remark'
import { defineConfig } from 'astro/config'
import icon from 'astro-icon'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

export default defineConfig({
  site: 'https://gsk.minyako.top',
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    mdx(),
    icon({
      include: {
        lucide: ['archive', 'book-open', 'chevron-down', 'chevron-up', 'external-link', 'house', 'moon', 'panel-right-close', 'panel-right-open', 'pause', 'play', 'rss', 'search', 'shapes', 'skip-back', 'skip-forward', 'sun', 'tags', 'volume-2'],
        'simple-icons': ['github']
      }
    })
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex]
    }),
    shikiConfig: {
      themes: {
        light: 'github-light-high-contrast',
        dark: 'github-dark-high-contrast'
      }
    }
  }
})
