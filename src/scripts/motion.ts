const revealSelector = '[data-motion-reveal]'

const show = (element: HTMLElement) => {
  element.dataset.motionState = 'visible'
}

export function initRevealMotion(root: ParentNode = document): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(revealSelector))
    .filter((element) => element.dataset.motionInitialized !== 'true')

  if (elements.length === 0) return

  elements.forEach((element) => {
    element.dataset.motionInitialized = 'true'
  })

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !('IntersectionObserver' in window)) {
    elements.forEach(show)
    return
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      const element = entry.target as HTMLElement
      show(element)
      observer.unobserve(element)
    })
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })

  elements.forEach((element) => {
    element.dataset.motionState = 'pending'
    observer.observe(element)
  })
}
