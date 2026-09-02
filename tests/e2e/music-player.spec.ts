import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

test('music player preserves preferences and can search hidden songs with lyrics', async ({ page }) => {
  await page.goto('/')

  const player = page.locator('[data-music-player]')
  await expect(player).toHaveAttribute('data-music-collapsed', 'true')
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'false')
  await expect(player.locator('[data-music-body]')).toBeHidden()

  await player.locator('[data-music-collapse]').click()
  await expect(player.locator('[data-music-body]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minyako-music-player') ?? '{}').collapsed)).toBe(false)

  await page.reload()
  await expect(player.locator('[data-music-body]')).toBeVisible()
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'true')

  const group = player.locator('[data-music-group]')
  await expect(group.locator('option[value="0"]')).toHaveCount(0)
  await expect(group.locator('option')).toHaveCount(2)

  await expect(player.locator('[data-music-aplayer] .aplayer-time')).toContainText('00:00')
  await expect.poll(() => player.locator('audio').evaluate((audio) => ({
    paused: (audio as HTMLAudioElement).paused,
    currentTime: (audio as HTMLAudioElement).currentTime,
  }))).toEqual({ paused: true, currentTime: 0 })

  const search = player.locator('[data-music-search]')
  await search.fill('春日影')
  const hiddenTrack = player.locator('.music-player-result').filter({ hasText: '春日影' })
  await expect(hiddenTrack).toHaveCount(1)
  await hiddenTrack.click()
  await expect(player.locator('[data-music-title]')).toHaveText('春日影')
  await expect(player.locator('[data-music-now]')).toContainText('春日影')
  await expect(player.locator('[data-music-lyrics]')).toContainText('悴んだ心')
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
