declare module 'aplayer' {
  export default class APlayer {
    constructor(options: Record<string, unknown>)
    list: { add(tracks: Record<string, unknown> | Record<string, unknown>[]): void; switch(index: number): void }
    on(event: string, callback: (...args: unknown[]) => void): void
    play(): void
    pause(): void
    destroy(): void
  }
}
