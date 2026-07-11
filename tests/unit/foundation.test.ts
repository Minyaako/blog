import { describe, expect, it } from 'vitest'
import { SITE } from '../../src/config/site'

describe('site foundation', () => {
  it('uses the production canonical origin and Chinese default language', () => {
    expect(SITE.origin).toBe('https://minyakogsk.icu')
    expect(SITE.lang).toBe('zh-CN')
  })
})
