import { expect, test } from './fixtures'

const routes = {
  home: '/',
  archive: '/archives/',
  article: '/posts/astro-content-architecture/',
  game: '/posts/visual-novel-memory/',
  moments: '/moments/',
  momentDetail: '/moments/20260824-005615-de5f1a7f/',
  search: '/search/',
  about: '/about/',
  notFound: '/404.html'
}

for (const theme of ['light', 'dark'] as const) {
  for (const [name, path] of Object.entries(routes)) {
    test(`${name} ${theme}`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('minyako-theme', value), theme)
      if (name === 'momentDetail') {
        await page.addInitScript(() => sessionStorage.setItem('minyako-warning:20260824-005615-de5f1a7f', 'accepted'))
      }
      await page.goto(path)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(page).toHaveScreenshot(`${name}-${theme}.png`, {
        fullPage: name !== 'moments' && name !== 'momentDetail',
        animations: 'disabled',
        maxDiffPixelRatio: 0.005
      })
    })
  }
}
