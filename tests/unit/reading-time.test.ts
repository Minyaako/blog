import { expect, it } from 'vitest'
import { getReadingTime } from '../../src/lib/reading-time'

it('counts Chinese characters and Latin words deterministically', () => {
  expect(getReadingTime('中文内容'.repeat(100) + ' astro static site '.repeat(40))).toEqual({
    minutes: 2,
    words: 520
  })
})
