declare module 'aplayer' {
  export interface APlayerListSwitchEvent {
    index: number
  }

  export default class APlayer {
    constructor(options: Record<string, unknown>)
    list: { add(tracks: Record<string, unknown> | Record<string, unknown>[]): void; switch(index: number): void }
    audio?: HTMLAudioElement
    on(event: 'listswitch', callback: (event: APlayerListSwitchEvent) => void): void
    on(event: 'volumechange', callback: (event: Event) => void): void
    on(event: string, callback: (...args: unknown[]) => void): void
    play(): void
    pause(): void
    destroy(): void
  }
}
