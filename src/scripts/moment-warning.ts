export function initMomentWarnings(root: ParentNode = document): () => void {
  const cleanups: Array<() => void> = []
  root.querySelectorAll<HTMLElement>('[data-moment-card]').forEach((card) => {
    if (card.dataset.warningInitialized === 'true') return
    card.dataset.warningInitialized = 'true'
    const warning = card.querySelector<HTMLElement>('[data-moment-warning]')
    const content = card.querySelector<HTMLElement>('[data-moment-protected-content]')
    const action = warning?.querySelector<HTMLButtonElement>('[data-warning-accept]')
    const id = card.dataset.momentId
    if (!content || !warning || !action || !id) return
    const storageKey = `minyako-warning:${id}`
    const accepted = sessionStorage.getItem(storageKey) === 'accepted'
    if (accepted) card.dataset.warningAccepted = 'true'
    else delete card.dataset.warningAccepted
    content.hidden = !accepted
    warning.hidden = accepted
    const accept = () => {
      sessionStorage.setItem(storageKey, 'accepted')
      card.dataset.warningAccepted = 'true'
      content.hidden = false
      warning.hidden = true
      content.tabIndex = -1
      content.focus({ preventScroll: true })
    }
    action.addEventListener('click', accept)
    cleanups.push(() => {
      action.removeEventListener('click', accept)
      delete card.dataset.warningInitialized
    })
  })
  return () => cleanups.forEach((cleanup) => cleanup())
}
