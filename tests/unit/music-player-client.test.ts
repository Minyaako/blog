// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const aplayer = vi.hoisted(() => {
  type Listener = (payload: unknown) => void
  const instances: Array<{
    audio: HTMLAudioElement
    options: { audio: Array<{ cover?: string }> }
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

    options: { audio: Array<{ cover?: string }> }

    constructor(options: { container: HTMLElement; audio: Array<{ cover?: string }> }) {
      this.options = options
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
    { id: 'one', groupId: '1', title: '一号', artists: ['甲'], audio: { url: 'https://example.com/one.mp3' }, lrcText: '{"t":0,"c":[{"tx":"作词: "},{"tx":"甲"}]}\n[00:00]第一首\n[00:01]第二句' },
    { id: 'two', groupId: '1', title: '二号', artists: ['乙'], audio: { url: 'https://example.com/two.mp3' }, lrcText: null },
  ],
  allTracks: [
    { id: 'one', groupId: '1', title: '一号', artists: ['甲'], audio: { url: 'https://example.com/one.mp3' }, lrcText: '{"t":0,"c":[{"tx":"作词: "},{"tx":"甲"}]}\n[00:00]第一首\n[00:01]第二句' },
    { id: 'two', groupId: '1', title: '二号', artists: ['乙'], audio: { url: 'https://example.com/two.mp3' }, lrcText: null },
    { id: 'track_hidden', groupId: '0', title: '隐藏曲目', artists: ['丙'], audio: { url: 'https://example.com/hidden.mp3' }, lrcText: '[00:00]隐藏歌词' },
  ],
}

const mount = () => {
  document.body.innerHTML = `
    <aside data-music-player>
      <button data-music-collapse><span data-music-icon="expand"></span><span data-music-icon="collapse" hidden></span></button><button data-music-minimize><span data-music-icon="minimize"></span><span data-music-icon="restore" hidden></span></button><span data-music-title></span><span data-music-artist></span>
      <p data-music-now></p><p data-music-current-lyric></p><div data-music-cover></div><div data-music-record></div><input data-music-progress type="range" /><output data-music-time></output>
      <button data-music-previous></button><button data-music-play-pause><span data-music-icon="play"></span><span data-music-icon="pause" hidden></span></button><button data-music-next></button><button data-music-volume-toggle aria-expanded="false"></button><div data-music-volume-popover hidden><input data-music-volume type="range" /></div>
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
  it('uses the journey-begin artwork as the centered fallback cover', () => {
    const player = mount()

    expect(player.options.audio[0].cover).toContain('33186e9fb044ed536211db6dd15c694898e6792f7b0bb8762872a82acb5d51fb')
    expect(document.querySelector<HTMLElement>('[data-music-cover]')?.style.backgroundImage)
      .toContain('33186e9fb044ed536211db6dd15c694898e6792f7b0bb8762872a82acb5d51fb')
    expect(document.querySelector<HTMLElement>('[data-music-record]')?.style.getPropertyValue('--music-artwork'))
      .toContain('33186e9fb044ed536211db6dd15c694898e6792f7b0bb8762872a82acb5d51fb')
    expect(document.querySelector('[data-music-aplayer]')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelector('[data-music-aplayer]')?.hasAttribute('inert')).toBe(true)
    expect(document.querySelector('[data-music-lyrics]')?.textContent).toContain('第一首')
    expect(document.querySelector('[data-music-lyrics]')?.textContent).toContain('作词: 甲')
    expect(document.querySelector('[data-music-lyrics]')?.textContent).not.toContain('{"t"')
  })

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
    const minimize = document.querySelector<HTMLButtonElement>('[data-music-minimize]')!
    const record = document.querySelector<HTMLElement>('[data-music-record]')!

    expect(playPause.querySelector<HTMLElement>('[data-music-icon="play"]')?.hidden).toBe(false)
    expect(playPause.querySelector<HTMLElement>('[data-music-icon="pause"]')?.hidden).toBe(true)
    expect(playPause.getAttribute('aria-label')).toBe('播放')
    expect(playPause.getAttribute('aria-pressed')).toBe('false')
    expect(collapse.getAttribute('aria-label')).toBe('展开音乐播放器')
    expect(minimize.getAttribute('aria-label')).toBe('最小化音乐播放器')

    player.emit('play', undefined)
    expect(playPause.querySelector<HTMLElement>('[data-music-icon="play"]')?.hidden).toBe(true)
    expect(playPause.querySelector<HTMLElement>('[data-music-icon="pause"]')?.hidden).toBe(false)
    expect(playPause.getAttribute('aria-label')).toBe('暂停')
    expect(playPause.getAttribute('aria-pressed')).toBe('true')
    expect(record.dataset.musicPlaying).toBe('true')

    player.emit('pause', undefined)
    expect(playPause.querySelector<HTMLElement>('[data-music-icon="play"]')?.hidden).toBe(false)
    expect(playPause.getAttribute('aria-pressed')).toBe('false')
    expect(record.dataset.musicPlaying).toBe('false')

    collapse.click()
    expect(collapse.getAttribute('aria-expanded')).toBe('true')
    expect(collapse.getAttribute('aria-label')).toBe('收起音乐播放器')
    expect(collapse.querySelector<HTMLElement>('[data-music-icon="collapse"]')?.hidden).toBe(false)

    minimize.click()
    expect(document.querySelector('[data-music-player]')?.getAttribute('data-music-minimized')).toBe('true')
    expect(minimize.getAttribute('aria-label')).toBe('恢复音乐播放器')
    expect(minimize.querySelector<HTMLElement>('[data-music-icon="restore"]')?.hidden).toBe(false)
    minimize.click()
    expect(document.querySelector('[data-music-player]')?.getAttribute('data-music-minimized')).toBe('false')
  })

  it('renders detailed visible tracks and filters them without exposing hidden group zero', () => {
    mount()

    const results = document.querySelector('[data-music-results]')!
    expect(results.querySelectorAll('.music-player-result')).toHaveLength(2)
    expect(results.textContent).toContain('一号')
    expect(results.textContent).toContain('甲')
    expect(results.textContent).toContain('公开歌单')
    expect(results.textContent).not.toContain('隐藏曲目')

    const search = document.querySelector<HTMLInputElement>('[data-music-search]')!
    search.value = '二号'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    expect(results.querySelectorAll('.music-player-result')).toHaveLength(1)
    expect(results.textContent).toContain('二号')
  })

  it('opens a separate volume popover and tracks the active lyric line', () => {
    const player = mount()
    const toggle = document.querySelector<HTMLButtonElement>('[data-music-volume-toggle]')!
    const popover = document.querySelector<HTMLElement>('[data-music-volume-popover]')!
    const lyrics = document.querySelector<HTMLElement>('[data-music-lyrics]')!
    const activeLine = [...document.querySelectorAll<HTMLElement>('[data-music-lyric-line]')]
      .find((line) => line.textContent === '第二句')!
    const scrollIntoView = vi.fn()
    const scrollTo = vi.fn()
    activeLine.scrollIntoView = scrollIntoView
    lyrics.scrollTo = scrollTo
    Object.defineProperties(lyrics, { clientHeight: { configurable: true, value: 100 } })
    Object.defineProperties(activeLine, {
      offsetTop: { configurable: true, value: 180 },
      offsetHeight: { configurable: true, value: 20 },
    })

    expect(popover.hidden).toBe(true)
    toggle.click()
    expect(popover.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    Object.defineProperty(player.audio, 'currentTime', { configurable: true, value: 1.1 })
    player.audio.dispatchEvent(new Event('timeupdate'))
    expect(document.querySelector('[data-music-lyric-line][aria-current="true"]')?.textContent).toContain('第二句')
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith({ top: 140, behavior: 'smooth' })
  })

  it('keeps the volume track fill synchronized with the selected volume', () => {
    const player = mount()
    const volume = document.querySelector<HTMLInputElement>('[data-music-volume]')!

    expect(volume.style.getPropertyValue('--music-volume-percent')).toBe('70%')

    volume.value = '0.42'
    volume.dispatchEvent(new Event('input', { bubbles: true }))

    expect(player.volume).toHaveBeenCalledWith(0.42, true)
    expect(volume.style.getPropertyValue('--music-volume-percent')).toBe('42%')
  })

  it('keeps previous and next navigation inside the current group', () => {
    const player = mount()
    dispatchMusicPlayRequest(document, 'track_hidden')
    player.list.switch.mockClear()

    document.querySelector<HTMLButtonElement>('[data-music-next]')!.click()
    expect(player.list.switch).toHaveBeenLastCalledWith(2)
    document.querySelector<HTMLButtonElement>('[data-music-previous]')!.click()
    expect(player.list.switch).toHaveBeenLastCalledWith(2)
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
