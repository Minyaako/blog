import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

test('music player starts collapsed without covering the page', async ({ page }) => {
  await page.goto('/')

  const player = page.locator('[data-music-player]')
  await expect(player).toHaveAttribute('data-music-collapsed', 'true')
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'false')
  await expect(player.locator('[data-music-body]')).toBeHidden()
})

test('expanded music player has no serious accessibility violations', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('minyako-music-player', JSON.stringify({ collapsed: true })))
  await page.goto('/')
  const player = page.locator('[data-music-player]')
  await player.locator('[data-music-collapse]').click()
  await expect(player.locator('[data-music-body]')).toBeVisible()

  const results = await new AxeBuilder({ page }).include('[data-music-player]').analyze()
  expect(results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
})
