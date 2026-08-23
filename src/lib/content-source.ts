type ContentEnvironment = Record<string, string | undefined>

export function resolvePostContentBase(environment: ContentEnvironment = process.env): string {
  if (environment.BLOG_E2E_EMPTY_CONTENT === 'true') return './tests/fixtures/empty-posts'
  if (environment.BLOG_E2E_FIXTURES === 'true') return './tests/fixtures/posts'
  return './src/content/posts'
}
