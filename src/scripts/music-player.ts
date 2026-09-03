import APlayer from 'aplayer'
import aplayerStyle from 'aplayer/dist/APlayer.min.css?inline'
import playerStyle from '../styles/music-player.css?inline'
import { MUSIC_PLAY_REQUEST_EVENT, type MusicPlayRequestDetail } from './music-play-request'

interface MusicAsset { url: string }
interface MusicCover { url: string }
interface PlayerTrack {
  id: string
  groupId: string
  title: string
  artists: string[]
  audio: MusicAsset
  cover?: MusicCover
  lrcText: string | null
}
interface MusicGroup { id: string; label: string; listed: boolean; order: number }
interface MusicPlayerModel { visibleGroups: MusicGroup[]; initialTracks: PlayerTrack[]; allTracks: PlayerTrack[] }
interface PlayerPreferences { volume: number; collapsed: boolean; lastVisibleTrackId: string | null }
type APlayerWithAudio = InstanceType<typeof APlayer> & {
  audio: HTMLAudioElement
  volume: (value: number, withoutStorage?: boolean) => number
  play: () => void | Promise<void>
}

const preferencesKey = 'minyako-music-player'
const fallbackPreferences: PlayerPreferences = { volume: 0.7, collapsed: true, lastVisibleTrackId: null }
const themeFallbackCover = '/images/profile/avatar-geometric.svg'
let activeCleanup: (() => void) | undefined

const aplayerControlLabels = {
  '.aplayer-icon-volume-down': '静音或取消静音', '.aplayer-icon-order': '切换播放顺序',
  '.aplayer-icon-loop': '切换循环模式', '.aplayer-icon-menu': '显示或隐藏播放列表',
  '.aplayer-icon-lrc': '显示或隐藏歌词', '.aplayer-icon-back': '上一首',
  '.aplayer-icon-forward': '下一首', '.aplayer-icon-play': '播放或暂停',
} as const

function labelAPlayerControls(container: HTMLElement): void {
  for (const [selector, label] of Object.entries(aplayerControlLabels)) {
    for (const control of container.querySelectorAll<HTMLElement>(selector)) {
      control.setAttribute('aria-label', label)
      control.setAttribute('title', label)
    }
  }
}

function loadPlayerStyle(): void {
  if (document.querySelector('[data-music-player-style]')) return
  const style = document.createElement('style')
  style.dataset.musicPlayerStyle = 'true'
  style.textContent = `${aplayerStyle}\n${playerStyle}`
  document.head.append(style)
}

function readPreferences(): PlayerPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(preferencesKey) ?? 'null')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...fallbackPreferences }
    const stored = value as Partial<PlayerPreferences>
    return {
      volume: typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1 ? stored.volume : fallbackPreferences.volume,
      collapsed: typeof stored.collapsed === 'boolean' ? stored.collapsed : fallbackPreferences.collapsed,
      lastVisibleTrackId: typeof stored.lastVisibleTrackId === 'string' ? stored.lastVisibleTrackId : null,
    }
  } catch { return { ...fallbackPreferences } }
}

function writePreferences(preferences: PlayerPreferences): void {
  try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)) } catch { /* Playback remains available without storage. */ }
}

const playerTrack = (track: PlayerTrack): Record<string, unknown> => ({
  name: track.title,
  artist: track.artists.join(' / '),
  url: track.audio.url,
  cover: track.cover?.url ?? themeFallbackCover,
  lrc: track.lrcText ?? '',
})

const searchableText = (track: PlayerTrack): string => `${track.title} ${track.artists.join(' ')}`.toLocaleLowerCase()

export function initMusicPlayer(root: ParentNode = document): void {
  const card = root.querySelector<HTMLElement>('[data-music-player]')
  if (!card || card.dataset.musicReady === 'true') return
  activeCleanup?.()
  card.dataset.musicReady = 'true'

  const data = card.querySelector<HTMLScriptElement>('[data-music-player-data]')
  const container = card.querySelector<HTMLElement>('[data-music-aplayer]')
  const title = card.querySelector<HTMLElement>('[data-music-title]')
  const artist = card.querySelector<HTMLElement>('[data-music-artist]')
  const now = card.querySelector<HTMLElement>('[data-music-now]')
  const currentLyric = card.querySelector<HTMLElement>('[data-music-current-lyric]')
  const lyrics = card.querySelector<HTMLElement>('[data-music-lyrics]')
  const error = card.querySelector<HTMLElement>('[data-music-error]')
  const group = card.querySelector<HTMLSelectElement>('[data-music-group]')
  const search = card.querySelector<HTMLInputElement>('[data-music-search]')
  const results = card.querySelector<HTMLElement>('[data-music-results]')
  const collapse = card.querySelector<HTMLButtonElement>('[data-music-collapse]')
  const playPause = card.querySelector<HTMLButtonElement>('[data-music-play-pause]')
  const volumeInput = card.querySelector<HTMLInputElement>('[data-music-volume]')
  const progressInput = card.querySelector<HTMLInputElement>('[data-music-progress]')
  const previous = card.querySelector<HTMLButtonElement>('[data-music-previous]')
  const next = card.querySelector<HTMLButtonElement>('[data-music-next]')
  const tabs = card.querySelectorAll<HTMLButtonElement>('[role="tab"][data-music-tab]')
  if (!data?.textContent || !container || !title || !artist || !now || !currentLyric || !lyrics || !error || !group || !search || !results || !collapse || !playPause || !volumeInput || !progressInput) return

  let model: MusicPlayerModel
  try { model = JSON.parse(data.textContent) as MusicPlayerModel } catch { return }
  if (model.initialTracks.length === 0) return

  loadPlayerStyle()
  const preferences = readPreferences()
  const visibleIds = new Set(model.visibleGroups.map((entry) => entry.id))
  const activeTracks = [...model.initialTracks]
  const player = new APlayer({
    container, audio: activeTracks.map(playerTrack), autoplay: false, lrcType: 1, volume: preferences.volume,
  }) as APlayerWithAudio
  const controller = new AbortController()
  const syncLyric = () => {
    const lyric = container.querySelector('.aplayer-lrc-current')?.textContent?.trim() || '暂无歌词'
    currentLyric.textContent = lyric
    lyrics.textContent = lyric
  }
  const observer = new MutationObserver(syncLyric)
  observer.observe(container, { childList: true, characterData: true, subtree: true })
  labelAPlayerControls(container)
  let currentIndex = 0

  const showError = (message: string) => { error.hidden = false; error.textContent = message }
  const setPlaying = (playing: boolean) => {
    playPause.textContent = playing ? '暂停' : '播放'
    playPause.setAttribute('aria-label', playing ? '暂停' : '播放')
    playPause.setAttribute('aria-pressed', String(playing))
  }
  const updateCurrent = () => {
    const track = activeTracks[currentIndex]
    if (!track) return
    title.textContent = track.title
    artist.textContent = track.artists.join(' / ')
    now.textContent = `${track.title} · ${track.artists.join(' / ')}`
    if (visibleIds.has(track.groupId)) preferences.lastVisibleTrackId = track.id
    writePreferences(preferences)
    syncLyric()
  }
  const ensureTrackInAPlayer = (track: PlayerTrack): number => {
    const existing = activeTracks.findIndex((entry) => entry.id === track.id)
    if (existing >= 0) return existing
    activeTracks.push(track)
    player.list.add(playerTrack(track))
    return activeTracks.length - 1
  }
  const selectTrack = (track: PlayerTrack) => {
    currentIndex = ensureTrackInAPlayer(track)
    player.list.switch(currentIndex)
    updateCurrent()
  }
  const setTab = (tabId: string, focus = false) => {
    const activeTab = [...tabs].find((tab) => tab.dataset.musicTab === tabId)
    if (!activeTab) return
    card.dataset.musicTab = tabId
    for (const tab of tabs) {
      const active = tab === activeTab
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    }
    for (const panel of card.querySelectorAll<HTMLElement>('[data-music-panel]')) {
      const active = panel.dataset.musicPanel === tabId
      panel.hidden = !active
      panel.setAttribute('aria-hidden', String(!active))
    }
    if (focus) activeTab.focus()
  }
  const setCollapsed = (collapsed: boolean) => {
    preferences.collapsed = collapsed
    card.dataset.musicCollapsed = String(collapsed)
    collapse.setAttribute('aria-expanded', String(!collapsed))
    collapse.setAttribute('aria-label', collapsed ? '展开音乐播放器' : '收起音乐播放器')
    writePreferences(preferences)
  }
  const updateProgress = () => {
    const duration = player.audio.duration
    const currentTime = player.audio.currentTime
    progressInput.max = Number.isFinite(duration) && duration > 0 ? String(duration) : '0'
    progressInput.value = Number.isFinite(currentTime) ? String(currentTime) : '0'
    syncLyric()
  }
  const renderSearch = () => {
    const query = search.value.trim().toLocaleLowerCase()
    results.replaceChildren()
    if (query === '') return
    const matches = model.allTracks.filter((track) => searchableText(track).includes(query)).slice(0, 12)
    for (const track of matches) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'music-player-result'
      button.textContent = `${track.title} · ${track.artists.join(' / ')}`
      button.addEventListener('click', () => selectTrack(track), { signal: controller.signal })
      results.append(button)
    }
    if (matches.length === 0) results.textContent = '没有匹配的歌曲。'
  }

  collapse.addEventListener('click', () => setCollapsed(card.dataset.musicCollapsed !== 'true'), { signal: controller.signal })
  group.addEventListener('change', () => {
    const track = model.initialTracks.find((item) => item.groupId === group.value)
    if (track) selectTrack(track)
  }, { signal: controller.signal })
  search.addEventListener('input', renderSearch, { signal: controller.signal })
  volumeInput.value = String(preferences.volume)
  volumeInput.addEventListener('input', () => {
    const volume = Number(volumeInput.value)
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) return
    player.volume(volume, true)
    preferences.volume = volume
    writePreferences(preferences)
  }, { signal: controller.signal })
  progressInput.addEventListener('input', () => { player.audio.currentTime = Number(progressInput.value) || 0 }, { signal: controller.signal })
  playPause.addEventListener('click', () => {
    if (player.audio.paused) void Promise.resolve(player.play()).catch(() => showError('播放失败，请再次点击播放。'))
    else player.pause()
  }, { signal: controller.signal })
  previous?.addEventListener('click', () => selectTrack(activeTracks[(currentIndex - 1 + activeTracks.length) % activeTracks.length]), { signal: controller.signal })
  next?.addEventListener('click', () => selectTrack(activeTracks[(currentIndex + 1) % activeTracks.length]), { signal: controller.signal })
  for (const [index, tab] of [...tabs].entries()) {
    tab.addEventListener('click', () => setTab(tab.dataset.musicTab ?? 'lyrics'), { signal: controller.signal })
    tab.addEventListener('keydown', (event) => {
      let targetIndex: number | undefined
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (index + 1) % tabs.length
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (index - 1 + tabs.length) % tabs.length
      if (event.key === 'Home') targetIndex = 0
      if (event.key === 'End') targetIndex = tabs.length - 1
      if (targetIndex === undefined || !tabs[targetIndex]) return
      event.preventDefault()
      setTab(tabs[targetIndex].dataset.musicTab ?? 'lyrics', true)
    }, { signal: controller.signal })
  }
  container.addEventListener('error', () => showError('播放失败，请检查网络后重试。'), { capture: true, signal: controller.signal })
  player.audio.addEventListener('timeupdate', updateProgress, { signal: controller.signal })
  player.audio.addEventListener('loadedmetadata', updateProgress, { signal: controller.signal })
  player.on('play', () => setPlaying(true))
  player.on('pause', () => setPlaying(false))
  player.on('volumechange', () => {
    if (player.audio.volume >= 0 && player.audio.volume <= 1) {
      preferences.volume = player.audio.volume
      volumeInput.value = String(player.audio.volume)
      writePreferences(preferences)
    }
  })
  player.on('listswitch', ({ index }: { index: number }) => {
    if (activeTracks[index]) { currentIndex = index; updateCurrent(); updateProgress() }
  })

  const requestTrack = (event: Event) => {
    const trackId = (event as CustomEvent<MusicPlayRequestDetail>).detail?.trackId
    const track = model.allTracks.find((item) => item.id === trackId)
    if (!track) { showError(`找不到歌曲：${trackId ?? ''}`); return }
    player.pause()
    selectTrack(track)
    void Promise.resolve(player.play()).catch(() => showError('播放失败，请再次点击播放。'))
  }
  document.addEventListener(MUSIC_PLAY_REQUEST_EVENT, requestTrack, { signal: controller.signal })

  const restored = model.initialTracks.findIndex((track) => track.id === preferences.lastVisibleTrackId)
  if (restored >= 0 && visibleIds.has(model.initialTracks[restored].groupId)) selectTrack(model.initialTracks[restored])
  group.value = model.initialTracks[currentIndex].groupId
  setCollapsed(preferences.collapsed)
  setPlaying(false)
  setTab(card.dataset.musicTab ?? 'lyrics')
  updateCurrent()
  updateProgress()
  activeCleanup = () => { controller.abort(); observer.disconnect(); player.destroy(); activeCleanup = undefined }
}
