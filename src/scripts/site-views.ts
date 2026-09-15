import { createViewCounterInstaller } from './view-counter'

// A dedicated Waline counter, separate from all article IDs and comment threads.
export const SITE_VIEWS_KEY = '__site_pageviews_v1__'
export const installSiteViews = createViewCounterInstaller({
  marker: '[data-site-views-page]',
  output: '[data-site-views-value]',
  pageKey: SITE_VIEWS_KEY,
})
