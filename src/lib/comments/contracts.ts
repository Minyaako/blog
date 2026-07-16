export interface CommentProvider {
  mount(target: HTMLElement, pageKey: string): Promise<void>
  getPageViews(pageKey: string): Promise<number>
  dispose(): void
}
