// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const aplayer = vi.hoisted(() => {
  type Listener = (payload: unknown) => void
  const instances: Array<{
    audio: HTMLAudioElement
    emit: (event: string, payload: unknown) => void
    list: { add: ReturnType<typeof vi.fn>; switch: ReturnType<typeof vi.fn> }
    pause: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    volume: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }> = []

  class MockAPlayer {
    audio = document.createElement('audio')
    list = { add: vi.fn(), switch: vi.fn() }
    pause = vi.fn()
    play = vi.fn(() => Promise.resolve())
    volume = vi.fn()
    destroy = vi.fn()
    private listeners = new Map<string, Listener>()

    constructor(options: { container: HTMLElement }) {
      options.container.append(this.audio)
      instances.push(this)
    }

    on(event: string, callback: Listener): void {
      this.listeners.set(event, callback)
    }

    emit(event: string, payload: unknown): void {
      this.listeners.get(event)?.(payload)
    }
  }

  return { instances, MockAPlayer }
})

vi.mock('aplayer', () => ({ default: aplayer.MockAPlayer }))

import { dispatchMusicPlayRequest } from '../../src/scripts/music-play-request'
import { initMusicPlayer } from '../../src/scripts/music-player'

const model = {
  visibleGroups: [{ id: '1', label: '公开歌单', listed: true, order: 1 }],
  initialTracks: [
    { id: 'one', groupId: '1', title: '一号', artists: ['甲'], audio: { url: 'https://example.com/one.mp3' }, lrcText: '[00:00]第一首' },
    { id: 'two', groupId: '1', title: '二号', artists: ['乙'], audio: { url: 'https://example.com/two.mp3' }, lrcText: null },
  ],
  allTracks: [
    { id: 'one', groupId: '1', title: '一号', artists: ['甲'], audio: { url: 'https://example.com/one.mp3' }, lrcText: '[00:00]第一首' },
    { id: 'two', groupId: '1', title: '二号', artists: ['乙'], audio: { url: 'https://example.com/two.mp3' }, lrcText: null },
    { id: 'track_hidden', groupId: '0', title: '隐藏曲目', artists: ['丙'], audio: { url: 'https://example.com/hidden.mp3' }, lrcText: '[00:00]隐藏歌词' },
  ],
}

const mount = () => {
  document.body.innerHTML = `
    <aside data-music-player>
      <button data-music-collapse></button><span data-music-title></span><span data-music-artist></span>
      <p data-music-now></p><p data-music-current-lyric></p><input data-music-progress type="range" />
      <button data-music-play-pause></button><input data-music-volume type="range" />
      <script type="application/json" data-music-player-data>${JSON.stringify(model)}</script>
      <div data-music-aplayer></div><p data-music-error></p><input data-music-search />
      <div data-music-results></div>
      <div role="tablist">
        <button id="music-tab-lyrics" data-music-tab="lyrics" role="tab" aria-controls="music-panel-lyrics">歌词</button>
        <button id="music-tab-songs" data-music-tab="songs" role="tab" aria-controls="music-panel-songs">歌曲</button>
      </div>
      <section id="music-panel-lyrics" data-music-panel="lyrics" role="tabpanel" aria-labelledby="music-tab-lyrics"><pre data-music-lyrics></pre></section>
      <section id="music-panel-songs" data-music-panel="songs" role="tabpanel" aria-labelledby="music-tab-songs"><select data-music-group><option value="1">公开歌单</option></select></section>
    </aside>`
  initMusicPlayer()
  return aplayer.instances.at(-1)!
}

afterEach(() => {
  document.body.replaceChildren()
  localStorage.clear()
  aplayer.instances.length = 0
})

describe('music player requests', () => {
  it('synchronizes tab panels and supports roving keyboard focus', () => {
    mount()

    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    const panels = [...document.querySelectorAll<HTMLElement>('[data-music-panel]')]
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1])
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true])
    expect(panels.every((panel) => panel.getAttribute('role') === 'tabpanel')).toBe(true)
    expect(tabs.every((tab) => tab.getAttribute('aria-controls') === `music-panel-${tab.dataset.musicTab}`)).toBe(true)

    tabs[0].focus()
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])
    expect(panels.map((panel) => panel.hidden)).toEqual([true, false])

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.activeElement).toBe(tabs[0])
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement).toBe(tabs[1])
  })

  it('reflects APlayer play state and collapse labels in owned controls', () => {
    const player = mount()
    const playPause = document.querySelector<HTMLButtonElement>('[data-music-play-pause]')!
    const collapse = document.querySelector<HTMLButtonElement>('[data-music-collapse]')!

    expect(playPause.textContent).toBe('播放')
    expect(playPause.getAttribute('aria-label')).toBe('播放')
    expect(playPause.getAttribute('aria-pressed')).toBe('false')
    expect(collapse.getAttribute('aria-label')).toBe('展开音乐播放器')

    player.emit('play', undefined)
    expect(playPause.textContent).toBe('暂停')
    expect(playPause.getAttribute('aria-label')).toBe('暂停')
    expect(playPause.getAttribute('aria-pressed')).toBe('true')

    player.emit('pause', undefined)
    expect(playPause.textContent).toBe('播放')
    expect(playPause.getAttribute('aria-pressed')).toBe('false')

    collapse.click()
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    expect(collapse.getAttribute('aria-label')).toBe('收起音乐播放器')
  })

  it('switches the one global player from a Moment request and plays in the click chain', () => {
    const player = mount()

    dispatchMusicPlayRequest(document, 'track_hidden')

    expect(player.pause).toHaveBeenCalledBefore(player.list.switch)
    expect(player.list.switch).toHaveBeenCalledWith(2)
    expect(player.play).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll('audio')).toHaveLength(1)
  })

  it('does not expose hidden group zero in the group picker', () => {
    mount()

    dispatchMusicPlayRequest(document, 'track_hidden')

    expect([...document.querySelectorAll('[data-music-group] option')].map((option) => option.textContent)).not.toContain('隐藏歌单')
    expect(document.querySelector('[data-music-title]')?.textContent).toBe('隐藏曲目')
  })

  it('reports an unavailable Moment track without creating another player', () => {
    mount()

    dispatchMusicPlayRequest(document, 'track_missing')

    expect(document.querySelector('[data-music-error]')?.textContent).toContain('track_missing')
    expect(aplayer.instances).toHaveLength(1)
  })

  it('does not duplicate the document request listener when initialized twice', () => {
    const player = mount()
    initMusicPlayer()

    dispatchMusicPlayRequest(document, 'track_hidden')

    expect(player.play).toHaveBeenCalledTimes(1)
  })
})
