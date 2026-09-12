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

// Keep navigation under Astro/browser control: never delay a request for an exit.
export function initPageMotion(root: Document = document): void {
  const view = root.defaultView
  if (!view || root.documentElement.dataset.motionNavigationInitialized === 'true') return
  root.documentElement.dataset.motionNavigationInitialized = 'true'
  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)')

  const syncNavigationMode = () => {
    const html = root.documentElement
    html.dataset.motionNavigation = reducedMotion.matches
      ? 'instant'
      : typeof root.startViewTransition === 'function' ? 'native' : 'fallback'
    html.removeAttribute('data-motion-page-state')
    html.removeAttribute('data-motion-target-domain')
    const domain = domainFromPathname(view.location.pathname)
    if (domain) html.dataset.motionDomain = domain
    else html.removeAttribute('data-motion-domain')
  }

  // The incoming document starts with the server's light theme. Set it before
  // Astro captures the new view, rather than repairing it after the first paint.
  root.addEventListener('astro:before-swap', (event) => {
    const next = (event as Event & { newDocument: Document }).newDocument.documentElement
    next.dataset.theme = root.documentElement.dataset.theme ?? 'light'
    next.classList.add('js')
  })
  reducedMotion.addEventListener('change', syncNavigationMode)
  view.addEventListener('pageshow', syncNavigationMode)
  root.addEventListener('astro:page-load', syncNavigationMode)
  syncNavigationMode()
}
