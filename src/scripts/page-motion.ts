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
  hasAttribute?: (qualifiedName: string) => boolean
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
  if (anchor.target || anchor.download || anchor.hasAttribute?.('download')) return false

  const target = new URL(anchor.href, current)
  if (!['http:', 'https:'].includes(target.protocol) || target.origin !== current.origin) return false
  if (target.pathname === current.pathname && target.search === current.search) return false
  return target.href !== current.href
}

const fallbackTimeout = 420
const clientRouterMarker = '[name="astro-view-transitions-enabled"]'

interface AstroPreparationEvent extends Event {
  to: URL
  sourceElement?: Element
}

function clearTransientMotionState(html: HTMLElement): void {
  html.removeAttribute('data-motion-page-state')
  html.removeAttribute('data-motion-target-domain')
}

export function initPageMotion(root: Document = document): void {
  const html = root.documentElement
  if (html.dataset.motionNavigationInitialized === 'true') return
  html.dataset.motionNavigationInitialized = 'true'

  const view = root.defaultView
  if (!view) return

  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)')
  let completePendingFallbackNavigation: (() => void) | undefined
  const syncNavigationMode = () => {
    const mode = reducedMotion.matches
      ? 'instant'
      : typeof root.startViewTransition === 'function' ? 'native' : 'fallback'
    html.dataset.motionNavigation = mode
    if (mode === 'instant') {
      clearTransientMotionState(html)
      completePendingFallbackNavigation?.()
    }
    return mode
  }
  const handlePageShow = () => {
    clearTransientMotionState(html)
    syncNavigationMode()
  }
  const handlePageLoad = () => {
    clearTransientMotionState(html)
    const domain = domainFromPathname(view.location.pathname)
    if (domain) html.dataset.motionDomain = domain
    else html.removeAttribute('data-motion-domain')
    syncNavigationMode()
  }
  const handleClientRouterPreparation = (event: Event) => {
    const transition = event as AstroPreparationEvent
    const mode = syncNavigationMode()
    if (mode === 'instant' || html.dataset.motionPageState === 'exiting') return
    const domain = transition.sourceElement instanceof HTMLElement
      ? transition.sourceElement.closest<HTMLElement>('[data-domain]')?.dataset.domain ?? domainFromPathname(transition.to.pathname)
      : domainFromPathname(transition.to.pathname)
    if (domain) html.dataset.motionTargetDomain = domain
    html.dataset.motionPageState = 'exiting'
  }

  syncNavigationMode()
  reducedMotion.addEventListener('change', syncNavigationMode)
  view.addEventListener('pageshow', handlePageShow)
  root.addEventListener('astro:before-preparation', handleClientRouterPreparation)
  root.addEventListener('astro:page-load', handlePageLoad)

  root.addEventListener('click', (event) => {
    const mouseEvent = event as MouseEvent
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest<HTMLAnchorElement>('a[href]')
    if (!link || !isEligibleNavigation(mouseEvent, link, new URL(view.location.href))) return
    if (root.querySelector(clientRouterMarker)) return

    const mode = syncNavigationMode()
    if (mode === 'instant') return
    if (mode === 'fallback') {
      event.preventDefault()
      if (html.dataset.motionPageState === 'exiting') return
    }

    const url = new URL(link.href, view.location.href)
    const domain = link.dataset.domain ?? domainFromPathname(url.pathname)
    if (domain) html.dataset.motionTargetDomain = domain

    if (mode === 'native') {
      if (domain) html.dataset.motionPageState = 'exiting'
      return
    }

    html.dataset.motionPageState = 'exiting'

    let navigated = false
    const navigate = () => {
      if (navigated) return
      navigated = true
      if (completePendingFallbackNavigation === navigate) {
        completePendingFallbackNavigation = undefined
      }
      main?.removeEventListener('animationend', handleAnimationEnd)
      view.location.assign(url.href)
    }

    const main = root.querySelector<HTMLElement>('.page-main')
    const handleAnimationEnd = (animationEvent: AnimationEvent) => {
      if (
        animationEvent.target === main &&
        animationEvent.animationName === 'motion-fallback-page-out'
      ) navigate()
    }

    completePendingFallbackNavigation = navigate
    main?.addEventListener('animationend', handleAnimationEnd)
    view.setTimeout(navigate, fallbackTimeout)
  })
}
