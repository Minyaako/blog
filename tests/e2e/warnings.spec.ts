import { expect, test } from './fixtures'

test('sensitive page requires confirmation and remembers it for the session', async ({ page }) => {
  await page.goto('/posts/visual-novel-memory')
  const dialog = page.getByRole('dialog', { name: '内容提示' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '确认并继续' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.cover img')).toHaveAttribute(
    'src',
    'https://pic.minyako.top/blog/posts/visual-novel-memory/cover-25ca0d1e0bb72d75603f7f42a50cfb48df6d4e9cd6bd055a7891ca40b89e274d.webp'
  )
  await page.reload()
  await expect(dialog).toBeHidden()
})
