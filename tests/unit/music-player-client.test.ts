// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const aplayer = vi.hoisted(() => {
  type Listener = (payload: unknown) => void
  const instances: Array<{
    audio: HTMLAudioElement
    emit: (event: string, payload: unknown) => void
    list: { add: ReturnType<typeof vi.fn>; switch: ReturnType<typeof vi.fn> }
  }> = []

  class MockAPlayer {
    audio = document.createElement('audio')
    list = { add: vi.fn(), switch: vi.fn() }
    private listeners = new Map<string, Listener>()

    constructor(_options: Record<string, unknown>) {
      instances.push(this)
    }

    on(event: string, callback: Listener): void {
      this.listeners.set(event, callback)
    }

    emit(event: string, payload: unknown): void {
      this.listeners.get(event)?.(payload)
    }

    play(): void {}
    pause(): void {}
    destroy(): void {}
  }

  return { instances, MockAPlayer }
})

vi.mock('aplayer', () => ({ default: aplayer.MockAPlayer }))

import { initMusicPlayer } from '../../src/scripts/music-player'

const model = {
  visibleGroups: [{ id: '1', label: '公开', listed: true, order: 1 }],
  initialTracks: [
    { id: 'one', groupId: '1', title: '一号', artists: ['甲'], audio: { url: 'https://example.com/one.mp3' }, lrcText: '[00:00]第一首' },
    { id: 'two', groupId: '1', title: '二号', artists: ['乙'], audio: { url: 'https://example.com/two.mp3' }, lrcText: null },
  ],
  allTracks: [],
}

const mount = () => {
  document.body.innerHTML = `
    <aside data-music-player>
      <button data-music-collapse></button><span data-music-title></span><p data-music-now></p>
      <script type="application/json" data-music-player-data>${JSON.stringify(model)}</script>
      <div data-music-aplayer></div><pre data-music-lyrics></pre><p data-music-error></p>
      <select data-music-group><option value="1">公开</option></select><input data-music-search />
      <div data-music-results></div>
    </aside>`
  initMusicPlayer()
  return aplayer.instances.at(-1)!
}

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
  aplayer.instances.length = 0
})

describe('music player APlayer events', () => {
  it('updates outer playback state and stored volume from real APlayer payload shapes', () => {
    const player = mount()

    player.emit('listswitch', { index: 1 })
    expect(document.querySelector('[data-music-title]')?.textContent).toBe('二号')
    expect(document.querySelector('[data-music-now]')?.textContent).toBe('二号 · 乙')
    expect(document.querySelector('[data-music-lyrics]')?.textContent).toBe('暂无歌词')
    expect(JSON.parse(localStorage.getItem('minyako-music-player') ?? '{}').lastVisibleTrackId).toBe('two')

    player.audio.volume = 0.42
    player.emit('volumechange', new Event('volumechange'))
    expect(JSON.parse(localStorage.getItem('minyako-music-player') ?? '{}').volume).toBeCloseTo(0.42)
  })
})
