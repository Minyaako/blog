export interface CommentProvider {
  mount(target: HTMLElement, pageKey: string): Promise<void>
  dispose(): void
}
