type ContentEnvironment = Record<string, string | undefined>

interface ClearableCollectionLoaderContext {
  store: {
    clear(): void
  }
}

interface ClearableCollectionLoader<TContext extends ClearableCollectionLoaderContext> {
  name: string
  load(context: TContext): Promise<void>
}

export function resolvePostContentBase(environment: ContentEnvironment = process.env): string {
  if (environment.BLOG_E2E_EMPTY_CONTENT === 'true') return './tests/fixtures/empty-posts'
  if (environment.BLOG_E2E_FIXTURES === 'true') return './tests/fixtures/posts'
  return './src/content/posts'
}

export function resolveMomentContentBase(environment: ContentEnvironment = process.env): string {
  return environment.BLOG_MOMENT_FIXTURES === 'true'
    ? './tests/fixtures/moments'
    : './src/content/moments'
}

export function generateMomentContentId(entry: string): string {
  const match = /^(?<id>\d{8}-\d{6}-[a-f0-9]{8})\.mdx$/.exec(entry)
  if (!match?.groups?.id) {
    throw new Error(`Moment entry must be a top-level src/content/moments/{id}.mdx file: ${entry}`)
  }
  return match.groups.id
}

export function clearCollectionBeforeLoad<
  TContext extends ClearableCollectionLoaderContext,
  TLoader extends ClearableCollectionLoader<TContext>,
>(loader: TLoader): TLoader {
  return {
    ...loader,
    async load(context) {
      context.store.clear()
      await loader.load(context)
    },
  } as TLoader
}
