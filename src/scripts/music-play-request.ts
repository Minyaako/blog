export const MUSIC_PLAY_REQUEST_EVENT = 'minyako:music-play-request' as const

export interface MusicPlayRequestDetail {
  trackId: string
}

export function dispatchMusicPlayRequest(target: EventTarget, trackId: string): void {
  target.dispatchEvent(new CustomEvent<MusicPlayRequestDetail>(MUSIC_PLAY_REQUEST_EVENT, {
    detail: { trackId },
  }))
}

export function bindMusicPlayRequestButtons(root: ParentNode = document): () => void {
  const controller = new AbortController()
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-moment-track-play]')) {
    button.addEventListener('click', () => {
      const trackId = button.dataset.momentTrackPlay
      if (trackId) dispatchMusicPlayRequest(document, trackId)
    }, { signal: controller.signal })
  }
  return () => controller.abort()
}
