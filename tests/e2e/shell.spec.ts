import { expect, test } from '@playwright/test'

test('renders accessible navigation and persists theme', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await expect(page.getByRole('link', { name: '查看全部', exact: true })).toHaveText('查看全部 →')
  await expect(page.getByRole('link', { name: '查看全部归档', exact: true })).toHaveText('查看全部归档 →')
  await page.getByRole('button', { name: '切换主题' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/)
})
