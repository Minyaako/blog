import { test as base } from '@playwright/test'
import path from 'node:path'
import mediaLock from '../../media/media.lock.json' with { type: 'json' }

const mediaByUrl = new Map(mediaLock.assets.flatMap((asset) => (
  typeof asset.file === 'string'
    ? [[asset.url, path.resolve('media', asset.file)] as const]
    : []
)))
const hostedMediaUrls = new Set(mediaLock.assets.flatMap((asset) => (
  asset.mode === 'hosted' ? [asset.url] : []
)))
const deterministicHostedImage = path.resolve('media/assets/posts/games-cover.webp')

export const test = base.extend<{ stableEnvironment: void }>({
  stableEnvironment: [async ({ page }, use) => {
    await page.clock.install({ time: new Date('2026-07-12T00:00:00+08:00') })
    await page.route('https://pic.minyako.top/blog/**', async (route) => {
      const file = mediaByUrl.get(route.request().url())
      if (!file) {
        if (hostedMediaUrls.has(route.request().url())) {
          await route.fulfill({ path: deterministicHostedImage, contentType: 'image/webp' })
          return
        }
        await route.abort('failed')
        return
      }
      await route.fulfill({ path: file, contentType: 'image/webp' })
    })
    await page.route('https://comments.minyako.top/**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/comment') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            errno: 0,
            data: { count: 0, data: [], page: 1, totalPages: 0 }
          })
        })
      }

      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Comments</title>' })
    })
    await page.addInitScript(() => {
      const style = document.createElement('style')
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'
      document.documentElement.append(style)
    })
    await use()
  }, { auto: true }]
})

export { expect } from '@playwright/test'
