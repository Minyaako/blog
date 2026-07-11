import { expect, test } from './fixtures'

const routes = {
  home: '/',
  archive: '/archives',
  article: '/posts/astro-content-architecture',
  game: '/posts/visual-novel-memory',
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
