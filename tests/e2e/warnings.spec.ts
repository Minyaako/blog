import { expect, test } from '@playwright/test'

test('sensitive page requires confirmation and remembers it for the session', async ({ page }) => {
  await page.goto('/posts/visual-novel-memory')
  const dialog = page.getByRole('dialog', { name: '内容提示' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认并继续' }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(dialog).toBeHidden()
})
