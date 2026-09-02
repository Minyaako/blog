import APlayer from 'aplayer'
import aplayerStyle from 'aplayer/dist/APlayer.min.css?inline'
import playerStyle from '../styles/music-player.css?inline'

interface MusicAsset {
  url: string
}

interface PlayerTrack {
  id: string
  groupId: string
  title: string
  artists: string[]
  audio: MusicAsset
  lrcText: string | null
}

interface MusicGroup {
  id: string
  label: string
  listed: boolean
  order: number
}

interface MusicPlayerModel {
  visibleGroups: MusicGroup[]
  initialTracks: PlayerTrack[]
  allTracks: PlayerTrack[]
}

interface PlayerPreferences {
  volume: number
  collapsed: boolean
  lastVisibleTrackId: string | null
}

const preferencesKey = 'minyako-music-player'

const fallbackPreferences: PlayerPreferences = { volume: 0.7, collapsed: true, lastVisibleTrackId: null }

const aplayerControlLabels = {
  '.aplayer-icon-volume-down': '静音或取消静音',
  '.aplayer-icon-order': '切换播放顺序',
  '.aplayer-icon-loop': '切换循环模式',
  '.aplayer-icon-menu': '显示或隐藏播放列表',
  '.aplayer-icon-lrc': '显示或隐藏歌词',
  '.aplayer-icon-back': '上一首',
  '.aplayer-icon-forward': '下一首',
  '.aplayer-icon-play': '播放或暂停',
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
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return fallbackPreferences
    const stored = value as Partial<PlayerPreferences>
    return {
      volume: typeof stored.volume === 'number' && stored.volume >= 0 && stored.volume <= 1 ? stored.volume : fallbackPreferences.volume,
      collapsed: typeof stored.collapsed === 'boolean' ? stored.collapsed : fallbackPreferences.collapsed,
      lastVisibleTrackId: typeof stored.lastVisibleTrackId === 'string' ? stored.lastVisibleTrackId : null,
    }
  } catch {
    return fallbackPreferences
  }
}

function writePreferences(preferences: PlayerPreferences): void {
  try {
    localStorage.setItem(preferencesKey, JSON.stringify(preferences))
  } catch {
    // Playback must keep working when storage is unavailable.
  }
}

const playerTrack = (track: PlayerTrack): Record<string, unknown> => ({
  name: track.title,
  artist: track.artists.join(' / '),
  url: track.audio.url,
  lrc: track.lrcText ?? '',
})

const searchableText = (track: PlayerTrack): string => `${track.title} ${track.artists.join(' ')}`.toLocaleLowerCase()

export function initMusicPlayer(root: ParentNode = document): void {
  const card = root.querySelector<HTMLElement>('[data-music-player]')
  if (!card || card.dataset.musicReady === 'true') return
  card.dataset.musicReady = 'true'

  const data = card.querySelector<HTMLScriptElement>('[data-music-player-data]')
  const container = card.querySelector<HTMLElement>('[data-music-aplayer]')
  const title = card.querySelector<HTMLElement>('[data-music-title]')
  const now = card.querySelector<HTMLElement>('[data-music-now]')
  const lyrics = card.querySelector<HTMLElement>('[data-music-lyrics]')
  const error = card.querySelector<HTMLElement>('[data-music-error]')
  const group = card.querySelector<HTMLSelectElement>('[data-music-group]')
  const search = card.querySelector<HTMLInputElement>('[data-music-search]')
  const results = card.querySelector<HTMLElement>('[data-music-results]')
  const collapse = card.querySelector<HTMLButtonElement>('[data-music-collapse]')
  if (!data?.textContent || !container || !title || !now || !lyrics || !error || !group || !search || !results || !collapse) return

  let model: MusicPlayerModel
  try {
    model = JSON.parse(data.textContent) as MusicPlayerModel
  } catch {
    return
  }
  if (model.initialTracks.length === 0) return

  loadPlayerStyle()
  const preferences = readPreferences()
  const visibleIds = new Set(model.visibleGroups.map((entry) => entry.id))
  const activeTracks = [...model.initialTracks]
  const player = new APlayer({
    container,
    audio: activeTracks.map(playerTrack),
    autoplay: false,
    lrcType: 1,
    volume: preferences.volume,
  })
  labelAPlayerControls(container)
  let currentIndex = 0

  const updateCurrent = () => {
    const track = activeTracks[currentIndex]
    if (!track) return
    title.textContent = track.title
    now.textContent = `${track.title} · ${track.artists.join(' / ')}`
    lyrics.textContent = track.lrcText ?? '暂无歌词'
    if (visibleIds.has(track.groupId)) preferences.lastVisibleTrackId = track.id
    writePreferences(preferences)
  }

  const selectTrack = (track: PlayerTrack) => {
    let index = activeTracks.findIndex((entry) => entry.id === track.id)
    if (index === -1) {
      activeTracks.push(track)
      player.list.add(playerTrack(track))
      index = activeTracks.length - 1
    }
    currentIndex = index
    player.list.switch(index)
    updateCurrent()
  }

  const setCollapsed = (collapsed: boolean) => {
    preferences.collapsed = collapsed
    card.dataset.musicCollapsed = String(collapsed)
    collapse.setAttribute('aria-expanded', String(!collapsed))
    writePreferences(preferences)
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
      button.addEventListener('click', () => selectTrack(track))
      results.append(button)
    }
    if (matches.length === 0) results.textContent = '没有匹配的歌曲。'
  }

  collapse.addEventListener('click', () => setCollapsed(card.dataset.musicCollapsed !== 'true'))
  group.addEventListener('change', () => {
    const next = model.initialTracks.find((track) => track.groupId === group.value)
    if (next) selectTrack(next)
  })
  search.addEventListener('input', renderSearch)
  container.addEventListener('error', () => {
    error.hidden = false
    error.textContent = '播放失败，请检查网络后重试。'
  }, true)
  player.on('volumechange', (event) => {
    const media = event.currentTarget instanceof HTMLMediaElement
      ? event.currentTarget
      : event.target instanceof HTMLMediaElement
        ? event.target
        : player.audio instanceof HTMLMediaElement ? player.audio : null
    if (media && media.volume >= 0 && media.volume <= 1) {
      preferences.volume = media.volume
      writePreferences(preferences)
    }
  })
  player.on('listswitch', ({ index }) => {
    if (activeTracks[index]) {
      currentIndex = index
      updateCurrent()
    }
  })

  const restored = model.initialTracks.findIndex((track) => track.id === preferences.lastVisibleTrackId)
  if (restored >= 0 && visibleIds.has(model.initialTracks[restored].groupId)) {
    currentIndex = restored
    player.list.switch(restored)
  }
  group.value = model.initialTracks[currentIndex].groupId
  setCollapsed(preferences.collapsed)
  updateCurrent()
}
