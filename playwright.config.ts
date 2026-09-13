import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const localChrome = process.env.CI ? {} : { channel: 'chrome' as const }
const walinePort = Number(process.env.RANKING_E2E_WALINE_PORT || 4336)
const walineOrigin = `http://127.0.0.1:${walinePort}`

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{platform}/{arg}-{projectName}{ext}',
  use: {
    baseURL: process.env.RANKING_E2E_ORIGIN || 'http://127.0.0.1:4321',
    trace: 'retain-on-failure'
  },
  webServer: process.env.RANKING_E2E_ORIGIN ? undefined : [
    {
      command: `node tests/fixtures/waline-server.mjs --port ${walinePort}`,
      url: `${walineOrigin}/healthz`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { WALINE_TEST_PORT: String(walinePort) },
    },
    {
      command: 'pnpm ranking:db seed --test-only && pnpm build && pnpm preview',
      url: 'http://127.0.0.1:4321',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        BLOG_E2E_FIXTURES: 'true', BLOG_MOMENT_FIXTURES: 'true',
        RANKING_DATABASE: resolve('.ranking-data/test-e2e.sqlite'),
        RANKING_ADMIN_IDS: '00000000-0000-4000-8000-000000000001',
        RANKING_WRITE_ENABLED: 'true', RANKING_ORIGIN: 'http://127.0.0.1:4321',
        RANKING_WALINE_URL: walineOrigin,
        HOST: '127.0.0.1', PORT: '4321',
      }
    },
  ],
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
