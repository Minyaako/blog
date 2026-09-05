import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

test('internal navigation retains the active player instance and playback position', async ({ page }) => {
  await page.addInitScript(() => {
    const playbackPositions = new WeakMap<HTMLMediaElement, number>()
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => 260 })
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() { return playbackPositions.get(this) ?? 0 },
      set(value: number) { playbackPositions.set(this, value) },
    })
    localStorage.setItem('minyako-music-player', JSON.stringify({ collapsed: true }))
  })
  await page.goto('/')

  const player = page.locator('[data-music-player]')
  const aplayer = player.locator('[data-music-aplayer]')
  const progress = player.locator('[data-music-progress]')
  await expect(aplayer).toHaveClass(/\baplayer\b/u)
  await aplayer.evaluate((element) => {
    element.dataset.navigationProbe = 'same-player'
  })
  await progress.evaluate((element) => {
    const input = element as HTMLInputElement
    input.value = '12'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await Promise.all([
    page.waitForURL(/\/archives\/?$/),
    page.locator('a[href="/archives/"]').first().click(),
  ])

  await expect(page.locator('[data-music-aplayer][data-navigation-probe="same-player"]')).toHaveCount(1)
  await expect.poll(() => page.locator('[data-music-progress]').inputValue()).toBe('12')
  await expect(page.locator('head [data-music-player-style]')).toHaveCount(1)
  await expect(player).toHaveCSS('position', 'fixed')
})

test('collapsed controls use a regular size hierarchy and an upward in-card volume popover', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('minyako-music-player', JSON.stringify({ collapsed: true })))
  await page.goto('/')

  const player = page.locator('[data-music-player]')
  const volumeToggle = player.locator('[data-music-volume-toggle]')
  const volumePopover = player.locator('[data-music-volume-popover]')

  await volumeToggle.click()
  await expect(volumePopover).toBeVisible()
  await expect(player.locator('[data-music-previous]')).toBeHidden()
  await expect(player.locator('[data-music-next]')).toBeHidden()

  const geometry = await player.evaluate((root) => {
    const box = (element: Element) => element.getBoundingClientRect()
    const playerBox = box(root)
    const volumeBox = box(root.querySelector('[data-music-volume-popover]')!)
    const volumeToggleBox = box(root.querySelector('[data-music-volume-toggle]')!)
    const playBox = box(root.querySelector('[data-music-play-pause]')!)
    const secondaryBoxes = ['[data-music-collapse]', '[data-music-minimize]', '[data-music-volume-toggle]']
      .map((selector) => box(root.querySelector(selector)!))
    const iconOffsets = Array.from(root.querySelectorAll<HTMLButtonElement>('.music-player-compact button'))
      .filter((button) => button.offsetParent !== null)
      .flatMap((button) => {
        const icon = Array.from(button.querySelectorAll<SVGElement>('svg')).find((candidate) => candidate.getClientRects().length > 0)
        if (!icon) return []
        const buttonBox = box(button)
        const iconBox = box(icon)
        return [{
          x: Math.abs(iconBox.left + iconBox.width / 2 - (buttonBox.left + buttonBox.width / 2)),
          y: Math.abs(iconBox.top + iconBox.height / 2 - (buttonBox.top + buttonBox.height / 2)),
        }]
      })

    return {
      iconOffsets,
      playSize: { width: playBox.width, height: playBox.height },
      volumeHeight: volumeBox.height,
      secondarySizes: secondaryBoxes.map(({ width, height }) => ({ width, height })),
      popoverInsidePlayer:
        volumeBox.left >= playerBox.left
        && volumeBox.right <= playerBox.right
        && volumeBox.top >= playerBox.top
        && volumeBox.bottom <= playerBox.bottom,
      popoverOpensUpward: volumeBox.bottom <= volumeToggleBox.top,
    }
  })

  expect(geometry.popoverInsidePlayer).toBe(true)
  expect(geometry.popoverOpensUpward).toBe(true)
  expect(geometry.volumeHeight).toBeGreaterThanOrEqual(68)
  expect(geometry.secondarySizes.every(({ width, height }) => Math.abs(width - 36) <= 1 && Math.abs(height - 36) <= 1)).toBe(true)
  expect(geometry.playSize.width).toBeGreaterThanOrEqual(42)
  expect(geometry.playSize.height).toBeGreaterThanOrEqual(42)
  expect(geometry.iconOffsets.length).toBeGreaterThan(0)
  expect(geometry.iconOffsets.every(({ x, y }) => x <= 1 && y <= 1)).toBe(true)
})

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
  const box = await player.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) - page.viewportSize()!.width)).toBeLessThanOrEqual(18)
  await expect(player.locator('[data-music-cover]')).toHaveCSS(
    'background-image',
    /33186e9fb044ed536211db6dd15c694898e6792f7b0bb8762872a82acb5d51fb/,
  )
  await expect(player.locator('button svg')).not.toHaveCount(0)
  await expect(player).toHaveAttribute('data-music-collapsed', 'true')
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'false')
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-label', '展开音乐播放器')
  await expect(player.locator('[data-music-body]')).toBeHidden()

  await player.locator('[data-music-minimize]').click()
  await expect(player).toHaveAttribute('data-music-minimized', 'true')
  await expect.poll(async () => (await player.boundingBox())?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(60)
  await player.locator('[data-music-minimize]').click()
  await expect(player).toHaveAttribute('data-music-minimized', 'false')

  await player.locator('[data-music-collapse]').click()
  await expect(player.locator('[data-music-body]')).toBeVisible()
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-label', '收起音乐播放器')
  await expect(player.locator('[data-music-volume-popover]')).toBeHidden()
  await player.locator('[data-music-volume-toggle]').click()
  await expect(player.locator('[data-music-volume-popover]')).toBeVisible()
  await expect(player.locator('[data-music-volume-toggle]')).toHaveAttribute('aria-expanded', 'true')
  await expect(player.locator('[data-music-expanded-cover]')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minyako-music-player') ?? '{}').collapsed)).toBe(false)

  await page.reload()
  await expect(player.locator('[data-music-body]')).toBeVisible()
  await expect(player.locator('[data-music-collapse]')).toHaveAttribute('aria-expanded', 'true')

  const group = player.locator('[data-music-group]')
  await expect(group.locator('option[value="0"]')).toHaveCount(0)
  await expect(group.locator('option')).toHaveCount(2)

  await expect(player.locator('[data-music-aplayer] .aplayer-time')).toContainText('00:00')
  await expect.poll(() => page.evaluate(() => (window as typeof window & { musicPlayCalls?: number }).musicPlayCalls)).toBe(0)
  await expect.poll(() => player.locator('[data-music-lyrics]').evaluate((node) => ({
    overflowY: getComputedStyle(node).overflowY,
    scrollable: node.scrollHeight > node.clientHeight,
  }))).toEqual({ overflowY: 'auto', scrollable: true })

  const search = player.locator('[data-music-search]')
  await player.locator('[data-music-tab="songs"]').click()
  await expect(player.locator('.music-player-result').first()).toBeVisible()
  await expect(player.locator('.music-player-result').first().locator('.music-player-result-group')).not.toBeEmpty()
  const lastVisibleTrack = player.locator('.music-player-result').last()
  await lastVisibleTrack.scrollIntoViewIfNeeded()
  await expect(lastVisibleTrack).toBeInViewport()
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
