import { defineConfig, devices } from '@playwright/test'

const localChrome = process.env.CI ? {} : { channel: 'chrome' as const }

export default defineConfig({
  testDir: 'tests/e2e-empty',
  use: {
    baseURL: 'http://127.0.0.1:4322',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4322',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: 'empty-desktop',
      use: { ...devices['Desktop Chrome'], ...localChrome }
    }
  ]
})
