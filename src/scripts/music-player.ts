import APlayer from 'aplayer'
import aplayerStyle from 'aplayer/dist/APlayer.min.css?inline'
import playerStyle from '../styles/music-player.css?inline'
import { MUSIC_UI } from '../config/site'
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
interface PlayerPreferences { volume: number; collapsed: boolean; minimized: boolean; lastVisibleTrackId: string | null }
type APlayerWithAudio = InstanceType<typeof APlayer> & {
  audio: HTMLAudioElement
  volume: (value: number, withoutStorage?: boolean) => number
  play: () => void | Promise<void>
}

const preferencesKey = 'minyako-music-player'
const fallbackPreferences: PlayerPreferences = { volume: 0.7, collapsed: true, minimized: false, lastVisibleTrackId: null }
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
      minimized: typeof stored.minimized === 'boolean' ? stored.minimized : fallbackPreferences.minimized,
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
  cover: track.cover?.url ?? MUSIC_UI.fallbackCoverUrl,
  lrc: track.lrcText ?? '',
})

const searchableText = (track: PlayerTrack): string => `${track.title} ${track.artists.join(' ')}`.toLocaleLowerCase()
const readableLyrics = (lrc: string | null): string => {
  if (!lrc) return '暂无歌词'
  const lines = lrc.split('\n').map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('{')) {
      try {
        const value = JSON.parse(trimmed) as { c?: Array<{ tx?: unknown }> }
        return value.c?.map((part) => typeof part.tx === 'string' ? part.tx : '').join('') ?? ''
      } catch { return '' }
    }
    return line.replace(/^(?:\[[^\]]+\])+/u, '')
  })
  return lines.join('\n').trim() || '暂无歌词'
}

interface TimedLyric { time: number; text: string }
const timedLyrics = (lrc: string | null): TimedLyric[] => {
  if (!lrc) return [{ time: 0, text: '暂无歌词' }]
  const parsed: TimedLyric[] = []
  for (const line of lrc.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('{')) {
      try {
        const value = JSON.parse(trimmed) as { t?: unknown; c?: Array<{ tx?: unknown }> }
        const text = value.c?.map((part) => typeof part.tx === 'string' ? part.tx : '').join('').trim()
        if (text) parsed.push({ time: typeof value.t === 'number' ? value.t / 1000 : 0, text })
      } catch { /* Ignore invalid enhanced-LRC metadata lines. */ }
      continue
    }
    const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/gu)]
    const text = line.replace(/^(?:\[[^\]]+\])+/u, '').trim()
    if (!text) continue
    if (stamps.length === 0) parsed.push({ time: Number.POSITIVE_INFINITY, text })
    for (const stamp of stamps) parsed.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]), text })
  }
  return parsed.length > 0 ? parsed.sort((a, b) => a.time - b.time) : [{ time: 0, text: readableLyrics(lrc) }]
}

export function initMusicPlayer(root: ParentNode = document): void {
  const card = root.querySelector<HTMLElement>('[data-music-player]')
  if (!card || card.dataset.musicReady === 'true') return
  activeCleanup?.()
  card.dataset.musicReady = 'true'

  const data = card.querySelector<HTMLScriptElement>('[data-music-player-data]')
  const container = card.querySelector<HTMLElement>('[data-music-aplayer]')
  const title = card.querySelector<HTMLElement>('[data-music-title]')
  const artist = card.querySelector<HTMLElement>('[data-music-artist]')
  const expandedTitle = card.querySelector<HTMLElement>('[data-music-expanded-title]')
  const expandedArtist = card.querySelector<HTMLElement>('[data-music-expanded-artist]')
  const now = card.querySelector<HTMLElement>('[data-music-now]')
  const currentLyric = card.querySelector<HTMLElement>('[data-music-current-lyric]')
  const cover = card.querySelector<HTMLElement>('[data-music-cover]')
  const record = card.querySelector<HTMLElement>('[data-music-record]')
  const lyrics = card.querySelector<HTMLElement>('[data-music-lyrics]')
  const error = card.querySelector<HTMLElement>('[data-music-error]')
  const group = card.querySelector<HTMLSelectElement>('[data-music-group]')
  const search = card.querySelector<HTMLInputElement>('[data-music-search]')
  const results = card.querySelector<HTMLElement>('[data-music-results]')
  const collapse = card.querySelector<HTMLButtonElement>('[data-music-collapse]')
  const minimize = card.querySelector<HTMLButtonElement>('[data-music-minimize]')
  const playPause = card.querySelector<HTMLButtonElement>('[data-music-play-pause]')
  const volumeToggle = card.querySelector<HTMLButtonElement>('[data-music-volume-toggle]')
  const volumePopover = card.querySelector<HTMLElement>('[data-music-volume-popover]')
  const volumeInput = card.querySelector<HTMLInputElement>('[data-music-volume]')
  const progressInput = card.querySelector<HTMLInputElement>('[data-music-progress]')
  const timeOutput = card.querySelector<HTMLOutputElement>('[data-music-time]')
  const previous = card.querySelector<HTMLButtonElement>('[data-music-previous]')
  const next = card.querySelector<HTMLButtonElement>('[data-music-next]')
  const tabs = card.querySelectorAll<HTMLButtonElement>('[role="tab"][data-music-tab]')
  if (!data?.textContent || !container || !title || !artist || !now || !currentLyric || !cover || !record || !lyrics || !error || !group || !search || !results || !collapse || !minimize || !playPause || !volumeToggle || !volumePopover || !volumeInput || !progressInput || !timeOutput) return

  let model: MusicPlayerModel
  try { model = JSON.parse(data.textContent) as MusicPlayerModel } catch { return }
  if (model.initialTracks.length === 0) return

  loadPlayerStyle()
  container.setAttribute('aria-hidden', 'true')
  container.setAttribute('inert', '')
  const preferences = readPreferences()
  const visibleIds = new Set(model.visibleGroups.map((entry) => entry.id))
  const activeTracks = [...model.initialTracks]
  const player = new APlayer({
    container, audio: activeTracks.map(playerTrack), autoplay: false, lrcType: 1, volume: preferences.volume,
  }) as APlayerWithAudio
  const controller = new AbortController()
  document.addEventListener('astro:after-swap', loadPlayerStyle, { signal: controller.signal })
  const syncLyric = () => {
    const lyric = container.querySelector('.aplayer-lrc-current')?.textContent?.trim() || '暂无歌词'
    currentLyric.textContent = lyric
  }
  const observer = new MutationObserver(syncLyric)
  observer.observe(container, { childList: true, characterData: true, subtree: true })
  labelAPlayerControls(container)
  let currentIndex = 0
  let activeLyricIndex = -1

  const showError = (message: string) => { error.hidden = false; error.textContent = message }
  const centerActiveLyric = (smooth = true) => {
    const active = lyrics.querySelector<HTMLElement>('[data-music-lyric-line][aria-current="true"]')
    if (!active || lyrics.clientHeight <= 0) return
    const lyricsBox = lyrics.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()
    if (activeBox.height <= 0) return
    const centeredTop = lyrics.scrollTop + activeBox.top - lyricsBox.top - lyrics.clientHeight / 2 + activeBox.height / 2
    const targetTop = Math.min(Math.max(0, lyrics.scrollHeight - lyrics.clientHeight), Math.max(0, centeredTop))
    if (smooth && typeof lyrics.scrollTo === 'function') lyrics.scrollTo({ top: targetTop, behavior: 'smooth' })
    else lyrics.scrollTop = targetTop
  }
  const centerActiveLyricAfterLayout = () => requestAnimationFrame(() => {
    centerActiveLyric(false)
    const animations = typeof card.getAnimations === 'function' ? card.getAnimations() : []
    if (animations.length === 0) return
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      requestAnimationFrame(() => centerActiveLyric(false))
    })
  })
  const setPlaying = (playing: boolean) => {
    const playIcon = playPause.querySelector<HTMLElement>('[data-music-icon="play"]')
    const pauseIcon = playPause.querySelector<HTMLElement>('[data-music-icon="pause"]')
    if (playIcon) playIcon.hidden = playing
    if (pauseIcon) pauseIcon.hidden = !playing
    playPause.setAttribute('aria-label', playing ? '暂停' : '播放')
    playPause.setAttribute('aria-pressed', String(playing))
    record.dataset.musicPlaying = String(playing)
  }
  const updateCurrent = () => {
    const track = activeTracks[currentIndex]
    if (!track) return
    title.textContent = track.title
    artist.textContent = track.artists.join(' / ')
    if (expandedTitle) expandedTitle.textContent = track.title
    if (expandedArtist) expandedArtist.textContent = track.artists.join(' / ')
    const artwork = track.cover?.url ?? MUSIC_UI.fallbackCoverUrl
    cover.style.backgroundImage = `url("${artwork}")`
    card.style.setProperty('--music-cover', `url("${artwork}")`)
    record.style.setProperty('--music-artwork', `url("${artwork}")`)
    lyrics.replaceChildren()
    for (const line of timedLyrics(track.lrcText)) {
      const item = document.createElement('p')
      item.dataset.musicLyricLine = ''
      item.dataset.musicLyricTime = String(line.time)
      item.textContent = line.text
      lyrics.append(item)
    }
    activeLyricIndex = -1
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
  const navigateGroup = (direction: -1 | 1) => {
    const current = activeTracks[currentIndex]
    if (!current) return
    const groupTracks = model.allTracks.filter((track) => track.groupId === current.groupId)
    const groupIndex = Math.max(0, groupTracks.findIndex((track) => track.id === current.id))
    const target = groupTracks[(groupIndex + direction + groupTracks.length) % groupTracks.length]
    if (target) selectTrack(target)
  }
  const setTab = (tabId: string, focus = false) => {
    const activeTab = [...tabs].find((tab) => tab.dataset.musicTab === tabId)
    if (!activeTab) return
    const wasLyricTab = card.dataset.musicTab === 'lyrics'
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
    if (tabId === 'lyrics' && !wasLyricTab && card.dataset.musicCollapsed !== 'true') centerActiveLyricAfterLayout()
    if (focus) activeTab.focus()
  }
  const setCollapsed = (collapsed: boolean) => {
    preferences.collapsed = collapsed
    card.dataset.musicCollapsed = String(collapsed)
    collapse.setAttribute('aria-expanded', String(!collapsed))
    collapse.setAttribute('aria-label', collapsed ? '展开音乐播放器' : '收起音乐播放器')
    const expandIcon = collapse.querySelector<HTMLElement>('[data-music-icon="expand"]')
    const collapseIcon = collapse.querySelector<HTMLElement>('[data-music-icon="collapse"]')
    if (expandIcon) expandIcon.hidden = !collapsed
    if (collapseIcon) collapseIcon.hidden = collapsed
    writePreferences(preferences)
    if (!collapsed) centerActiveLyricAfterLayout()
  }
  const setMinimized = (minimized: boolean) => {
    preferences.minimized = minimized
    card.dataset.musicMinimized = String(minimized)
    minimize.setAttribute('aria-label', minimized ? '恢复音乐播放器' : '最小化音乐播放器')
    const minimizeIcon = minimize.querySelector<HTMLElement>('[data-music-icon="minimize"]')
    const restoreIcon = minimize.querySelector<HTMLElement>('[data-music-icon="restore"]')
    if (minimizeIcon) minimizeIcon.hidden = minimized
    if (restoreIcon) restoreIcon.hidden = !minimized
    writePreferences(preferences)
    if (!minimized && card.dataset.musicCollapsed !== 'true' && card.dataset.musicTab === 'lyrics') centerActiveLyricAfterLayout()
  }
  const syncVolumeTrack = (volume: number) => {
    volumeInput.style.setProperty('--music-volume-percent', `${Math.round(volume * 100)}%`)
  }
  const updateProgress = () => {
    const duration = player.audio.duration
    const currentTime = player.audio.currentTime
    progressInput.max = Number.isFinite(duration) && duration > 0 ? String(duration) : '0'
    progressInput.value = Number.isFinite(currentTime) ? String(currentTime) : '0'
    const formatTime = (seconds: number) => {
      const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
      return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
    }
    timeOutput.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`
    const lyricLines = [...lyrics.querySelectorAll<HTMLElement>('[data-music-lyric-line]')]
    const nextLyricIndex = lyricLines.reduce((found, line, index) => Number(line.dataset.musicLyricTime) <= currentTime ? index : found, -1)
    if (nextLyricIndex !== activeLyricIndex && lyricLines[nextLyricIndex]) {
      lyricLines[activeLyricIndex]?.removeAttribute('aria-current')
      const active = lyricLines[nextLyricIndex]
      active.setAttribute('aria-current', 'true')
      activeLyricIndex = nextLyricIndex
      centerActiveLyric()
    }
    syncLyric()
  }
  const renderTracks = () => {
    const query = search.value.trim().toLocaleLowerCase()
    results.replaceChildren()
    const visibleGroupIds = new Set(model.visibleGroups.map((entry) => entry.id))
    const matches = model.allTracks.filter((track) => {
      if (query !== '') return searchableText(track).includes(query)
      return visibleGroupIds.has(track.groupId) && (group.value === '' || track.groupId === group.value)
    }).slice(0, 24)
    for (const track of matches) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'music-player-result'
      button.dataset.musicTrackId = track.id
      const artwork = track.cover?.url ?? MUSIC_UI.fallbackCoverUrl
      const groupLabel = model.visibleGroups.find((entry) => entry.id === track.groupId)?.label ?? '隐藏分组'
      button.innerHTML = `<span class="music-player-result-cover" aria-hidden="true"></span><span class="music-player-result-copy"><strong></strong><small></small></span><span class="music-player-result-group"></span>`
      const coverNode = button.querySelector<HTMLElement>('.music-player-result-cover')!
      coverNode.style.backgroundImage = `url("${artwork}")`
      button.querySelector('strong')!.textContent = track.title
      button.querySelector('small')!.textContent = track.artists.join(' / ')
      button.querySelector('.music-player-result-group')!.textContent = groupLabel
      button.addEventListener('click', () => selectTrack(track), { signal: controller.signal })
      results.append(button)
    }
    if (matches.length === 0) results.textContent = '没有匹配的歌曲。'
  }

  collapse.addEventListener('click', () => setCollapsed(card.dataset.musicCollapsed !== 'true'), { signal: controller.signal })
  minimize.addEventListener('click', () => setMinimized(card.dataset.musicMinimized !== 'true'), { signal: controller.signal })
  group.addEventListener('change', () => {
    renderTracks()
  }, { signal: controller.signal })
  search.addEventListener('input', renderTracks, { signal: controller.signal })
  volumeInput.value = String(preferences.volume)
  syncVolumeTrack(preferences.volume)
  volumeInput.addEventListener('input', () => {
    const volume = Number(volumeInput.value)
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) return
    player.volume(volume, true)
    syncVolumeTrack(volume)
    preferences.volume = volume
    writePreferences(preferences)
  }, { signal: controller.signal })
  volumeToggle.addEventListener('click', () => {
    const open = volumePopover.hidden
    volumePopover.hidden = !open
    volumeToggle.setAttribute('aria-expanded', String(open))
  }, { signal: controller.signal })
  progressInput.addEventListener('input', () => { player.audio.currentTime = Number(progressInput.value) || 0 }, { signal: controller.signal })
  playPause.addEventListener('click', () => {
    if (player.audio.paused) void Promise.resolve(player.play()).catch(() => showError('播放失败，请再次点击播放。'))
    else player.pause()
  }, { signal: controller.signal })
  previous?.addEventListener('click', () => navigateGroup(-1), { signal: controller.signal })
  next?.addEventListener('click', () => navigateGroup(1), { signal: controller.signal })
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
      syncVolumeTrack(player.audio.volume)
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
  setMinimized(preferences.minimized)
  setPlaying(false)
  setTab(card.dataset.musicTab ?? 'lyrics')
  updateCurrent()
  renderTracks()
  updateProgress()
  activeCleanup = () => { controller.abort(); observer.disconnect(); player.destroy(); activeCleanup = undefined }
}
