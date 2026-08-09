import { describe, expect, it } from 'vitest'
import { domainFromPathname, isEligibleNavigation } from '../../src/scripts/page-motion'

const event = (overrides = {}) => ({
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
})

const anchor = (href: string, overrides = {}) => ({
  href,
  target: '',
  download: '',
  ...overrides,
})

describe('page motion navigation intent', () => {
  it.each([
    ['/domains/academic', 'academic'],
    ['/domains/engineering/tools', 'engineering'],
    ['/domains/life/', 'life'],
    ['/domains/games/reviews', 'games'],
    ['/archives', undefined],
  ])('maps %s to %s', (pathname, expected) => {
    expect(domainFromPathname(pathname)).toBe(expected)
  })

  it('accepts only ordinary same-origin page navigation', () => {
    const current = new URL('https://example.com/')
    expect(isEligibleNavigation(event(), anchor('https://example.com/archives'), current)).toBe(true)
    expect(isEligibleNavigation(event({ ctrlKey: true }), anchor('https://example.com/archives'), current)).toBe(false)
    expect(isEligibleNavigation(event({ button: 1 }), anchor('https://example.com/archives'), current)).toBe(false)
    expect(isEligibleNavigation(event(), anchor('https://elsewhere.example/'), current)).toBe(false)
    expect(isEligibleNavigation(event(), anchor('mailto:test@example.com'), current)).toBe(false)
    expect(isEligibleNavigation(event(), anchor('https://example.com/#main-content'), current)).toBe(false)
    expect(isEligibleNavigation(event(), anchor('https://example.com/archive.zip', { download: 'archive.zip' }), current)).toBe(false)
    expect(isEligibleNavigation(event(), anchor('https://example.com/archives', { target: '_blank' }), current)).toBe(false)
  })
})
