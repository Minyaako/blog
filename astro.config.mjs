import mdx from '@astrojs/mdx'
import { unified } from '@astrojs/markdown-remark'
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'
import icon from 'astro-icon'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

export default defineConfig({
  site: 'https://minyakogsk.icu',
  output: 'static',
  trailingSlash: 'never',
  integrations: [
    mdx(),
    sitemap(),
    icon({
      include: {
        lucide: ['archive', 'chevron-down', 'external-link', 'house', 'moon', 'rss', 'search', 'sun'],
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
        light: 'github-light',
        dark: 'github-dark'
      }
    }
  }
})
