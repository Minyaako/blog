import { defineConfig, devices } from '@playwright/test'

const localChrome = process.env.CI ? {} : { channel: 'chrome' as const }

export default defineConfig({
  testDir: 'tests/e2e-empty',
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://127.0.0.1:4322',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { BLOG_E2E_EMPTY_CONTENT: 'true', HOST: '127.0.0.1', PORT: '4322' }
  },
  projects: [
    {
      name: 'empty-desktop',
      use: { ...devices['Desktop Chrome'], ...localChrome }
    }
  ]
})
