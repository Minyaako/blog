import type { DomainKey } from '../config/taxonomy'

export interface NavigationEventLike {
  defaultPrevented: boolean
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export interface NavigationAnchorLike {
  href: string
  target: string
  download: string
}

const domainPattern = /^\/domains\/(academic|engineering|life|games)(?:\/|$)/

export function domainFromPathname(pathname: string): DomainKey | undefined {
  return domainPattern.exec(pathname)?.[1] as DomainKey | undefined
}

export function isEligibleNavigation(
  event: NavigationEventLike,
  anchor: NavigationAnchorLike,
  current: URL,
): boolean {
  if (event.defaultPrevented || event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false
  if (anchor.target || anchor.download) return false

  const target = new URL(anchor.href, current)
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== current.origin) return false
  if (target.pathname === current.pathname && target.search === current.search && target.hash) return false
  return target.href !== current.href
}

const fallbackTimeout = 420

export function initPageMotion(root: Document = document): void {
  const html = root.documentElement
  if (html.dataset.motionNavigation !== 'fallback' || html.dataset.motionNavigationInitialized === 'true') return
  html.dataset.motionNavigationInitialized = 'true'

  root.addEventListener('click', (event) => {
    const mouseEvent = event as MouseEvent
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest<HTMLAnchorElement>('a[href]')
    if (!link || !isEligibleNavigation(mouseEvent, link, new URL(location.href))) return

    event.preventDefault()
    if (html.dataset.motionPageState === 'exiting') return

    const url = new URL(link.href, location.href)
    const domain = link.dataset.domain ?? domainFromPathname(url.pathname)
    if (domain) html.dataset.motionTargetDomain = domain
    html.dataset.motionPageState = 'exiting'

    let navigated = false
    const navigate = () => {
      if (navigated) return
      navigated = true
      main?.removeEventListener('animationend', handleAnimationEnd)
      location.assign(url.href)
    }

    const main = root.querySelector<HTMLElement>('.page-main')
    const handleAnimationEnd = (animationEvent: AnimationEvent) => {
      if (
        animationEvent.target === main &&
        animationEvent.animationName === 'motion-fallback-page-out'
      ) navigate()
    }

    main?.addEventListener('animationend', handleAnimationEnd)
    window.setTimeout(navigate, fallbackTimeout)
  })
}
