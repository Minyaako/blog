import { describe, expect, it } from 'vitest'
import { getAvatarInitial } from '../../src/lib/comments/avatar'

describe('comment avatar fallback', () => {
  it.each([
    [' 小明 ', '小'],
    ['alice', 'A'],
    ['😊 visitor', '😊'],
    ['', '?']
  ])('uses the first visible nickname character for %j', (nickname, expected) => {
    expect(getAvatarInitial(nickname)).toBe(expected)
  })
})
