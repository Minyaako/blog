import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

test('music player preserves preferences and can search hidden songs with lyrics', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { musicPlayCalls?: number }
    const originalPlay = HTMLMediaElement.prototype.play
    state.musicPlayCalls = 0
    HTMLMediaElement.prototype.play = function (...args) {
      state.musicPlayCalls = (state.musicPlayCalls ?? 0) + 1
      return originalPlay.apply(this, args)
    }
  })
  await page.goto('/')

  const player = page.locator('[data-music-player]')
  await expect(player).toHaveAttribute('data-music-collapsed', 'true')
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'false')
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-label', '展开音乐播放器')
  await expect(player.locator('[data-music-body]')).toBeHidden()

  await player.locator('[data-music-collapse]').click()
  await expect(player.locator('[data-music-body]')).toBeVisible()
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-label', '收起音乐播放器')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minyako-music-player') ?? '{}').collapsed)).toBe(false)

  await page.reload()
  await expect(player.locator('[data-music-body]')).toBeVisible()
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'true')

  const group = player.locator('[data-music-group]')
  await expect(group.locator('option[value="0"]')).toHaveCount(0)
  await expect(group.locator('option')).toHaveCount(2)

  await expect(player.locator('[data-music-aplayer] .aplayer-time')).toContainText('00:00')
  await expect.poll(() => page.evaluate(() => (window as typeof window & { musicPlayCalls?: number }).musicPlayCalls)).toBe(0)

  const search = player.locator('[data-music-search]')
  await player.locator('[data-music-tab="songs"]').click()
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

test('music player tabs expose synchronized panels and keyboard focus', async ({ page }) => {
  await page.goto('/')
  const player = page.locator('[data-music-player]')
  const tabs = player.locator('[role="tab"]')
  await player.locator('[data-music-collapse]').click()

  await expect(player.locator('[role="tablist"]')).toHaveCount(1)
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.nth(0)).toHaveAttribute('aria-controls', 'music-panel-lyrics')
  await expect(tabs.nth(0)).toHaveAttribute('tabindex', '0')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(tabs.nth(1)).toHaveAttribute('aria-controls', 'music-panel-songs')
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1')
  await expect(player.locator('[role="tabpanel"]')).toHaveCount(2)
  await expect(player.locator('#music-panel-lyrics')).toBeVisible()
  await expect(player.locator('#music-panel-songs')).toBeHidden()

  await tabs.nth(0).press('ArrowRight')
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(player.locator('#music-panel-lyrics')).toBeHidden()
  await expect(player.locator('#music-panel-songs')).toBeVisible()
  await tabs.nth(1).press('Home')
  await expect(tabs.nth(0)).toBeFocused()
  await tabs.nth(0).press('End')
  await expect(tabs.nth(1)).toBeFocused()
})

test('a Moment request switches and plays through the one global player', async ({ page }) => {
  await page.goto('/moments/')
  const player = page.locator('[data-music-player]')

  await page.locator('[data-moment-track-play="track_imhB5DKgMYvXv4YuwjyvBPL9"]').click()

  await expect(player.locator('[data-music-title]')).toHaveText('春日影')
  await expect(player.locator('[data-music-group] option[value="0"]')).toHaveCount(0)
  await expect(player.locator('.aplayer')).toHaveCount(1)
})
