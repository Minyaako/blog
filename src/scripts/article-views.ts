import { createViewCounterInstaller } from './view-counter'

export const installArticleViews = createViewCounterInstaller({
  marker: '[data-article-views]',
  output: '[data-article-views-value]',
  requireOutput: true,
})
