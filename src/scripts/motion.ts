const revealSelector = '[data-motion-reveal]'

// Content is readable on its first paint, including newly appended stream cards.
// Do not hide server-rendered content while waiting for an observer or a stagger.
export function initRevealMotion(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>(revealSelector).forEach((element) => {
    element.dataset.motionInitialized = 'true'
    element.dataset.motionState = 'visible'
  })
}
