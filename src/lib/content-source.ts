type ContentEnvironment = Record<string, string | undefined>

export function resolvePostContentBase(environment: ContentEnvironment = process.env): string {
  return environment.BLOG_E2E_FIXTURES === 'true'
    ? './tests/fixtures/posts'
    : './src/content/posts'
}
