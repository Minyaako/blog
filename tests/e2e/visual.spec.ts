import { expect, test } from './fixtures'

const routes = {
  article: '/posts/astro-content-architecture',
  search: '/search',
  about: '/about',
  notFound: '/404'
}

for (const theme of ['light', 'dark'] as const) {
  for (const [name, path] of Object.entries(routes)) {
    test(`${name} ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('minyako-theme', value), theme)
      await page.goto(path)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.005
      })
    })
  }
}

const stableRegions = {
  archive: ['/archives', '.page-heading'],
  game: ['/posts/visual-novel-memory', '.article-header']
} as const

for (const theme of ['light', 'dark'] as const) {
  for (const [name, [path, selector]] of Object.entries(stableRegions)) {
    test(`${name} structure ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('minyako-theme', value), theme)
      await page.goto(path)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page.locator(selector)).toHaveScreenshot(`${name}-structure-${theme}.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.005
      })
    })
  }
}
