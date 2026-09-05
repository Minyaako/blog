import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function stabilizePageScreenshot(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'html { overflow-y: scroll !important; } [data-music-player] { display: none !important; }' })
  await expect(page.locator('html')).toHaveCSS('overflow-y', 'scroll')
  await expect(page.locator('[data-music-player]')).toBeHidden()
}

const routes = {
  home: '/',
  archive: '/archives/',
  article: '/posts/astro-content-architecture/',
  game: '/posts/visual-novel-memory/',
  moments: '/moments/',
  momentDetail: '/moments/20260823-143501-a7c31e4f/',
  search: '/search/',
  about: '/about/',
  notFound: '/404.html'
}

for (const theme of ['light', 'dark'] as const) {
  for (const [name, path] of Object.entries(routes)) {
    test(`${name} ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('minyako-theme', value), theme)
      if (name === 'momentDetail') {
        await page.addInitScript(() => sessionStorage.setItem('minyako-warning:20260823-143501-a7c31e4f', 'accepted'))
      }
      const response = await page.goto(path)
      if (name === 'momentDetail') {
        expect(response?.status()).toBe(200)
        await expect(page.locator('[data-moment-card]')).toHaveCount(1)
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await stabilizePageScreenshot(page)
      const fullPage = name !== 'moments' && name !== 'momentDetail'
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        fullPage,
        animations: 'disabled',
        maxDiffPixelRatio: 0.005
      })
    })
  }
}

test('music player desktop', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('[data-music-player]')).toHaveScreenshot('music-player-desktop.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  })
})

test('music player mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const player = page.locator('[data-music-player]')
  await player.locator('[data-music-collapse]').click()
  await expect(player.locator('.music-player-cover')).toBeHidden()
  await expect(player.locator('.music-player-instance .aplayer-pic')).toBeHidden()
  await expect(player).toHaveScreenshot('music-player-mobile.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.005,
  })
})
