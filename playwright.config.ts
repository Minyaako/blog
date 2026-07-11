import { defineConfig, devices } from '@playwright/test'

const localChrome = process.env.CI ? {} : { channel: 'chrome' as const }

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'pnpm build && pnpm preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...localChrome }
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], ...localChrome }
    },
    {
      name: 'tablet',
      use: { viewport: { width: 834, height: 1112 }, ...localChrome }
    }
  ]
})
