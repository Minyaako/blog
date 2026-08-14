export function getAvatarInitial(nickname: string): string {
  const firstCharacter = Array.from(nickname.trim())[0]
  return firstCharacter ? firstCharacter.toLocaleUpperCase('zh-CN') : '?'
}

const EMPTY_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"

function enhanceCardAvatar(card: Element): void {
  const user = card.querySelector<HTMLElement>('.wl-user')
  const image = user?.querySelector<HTMLImageElement>('.wl-user-avatar')
  if (!user || !image) return

  if (image.getAttribute('src') !== EMPTY_AVATAR) {
    delete user.dataset.avatarInitial
    image.hidden = false
    return
  }

  const nickname = card.querySelector<HTMLElement>('.wl-nick')?.textContent ?? ''
  user.dataset.avatarInitial = getAvatarInitial(nickname)
  image.hidden = true
}

export function watchAnonymousAvatars(root: HTMLElement): () => void {
  const enhanceAll = () => root.querySelectorAll('.wl-card-item').forEach(enhanceCardAvatar)
  const observer = new MutationObserver(enhanceAll)

  enhanceAll()
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })

  return () => observer.disconnect()
}
