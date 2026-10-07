import { describe, expect, it } from 'vitest'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { JSDOM } from 'jsdom'
import remarkMath from 'remark-math'
import remarkInlineSpoiler from '../../src/lib/remark-inline-spoiler.mjs'
import { installInlineSpoilers } from '../../src/scripts/inline-spoiler'

const processor = createMarkdownProcessor({ remarkPlugins: [remarkMath, remarkInlineSpoiler] })
const render = async (value: string) => (await (await processor).render(value)).code

describe('inline hidden text', () => {
  it('renders multiple plain-text secrets safely with initially hidden accessible content', async () => {
    const html = await render('前 ||剧透 & 答案|| 后 ||第二处||')
    const document = new JSDOM(html).window.document
    const buttons = document.querySelectorAll('button[data-inline-spoiler]')
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent).toBe('剧透 & 答案')
    expect(buttons[0].getAttribute('aria-expanded')).toBe('false')
    expect(buttons[0].querySelector('span')?.getAttribute('aria-hidden')).toBe('true')
  })
  it.each(['||"秘密"||', 'Hello... ||秘密||', '普通 &amp; 文字 ||秘密||'])('retains hidden text after typography changes: %s', async (source) => {
    const document = new JSDOM(await render(source)).window.document
    expect(document.querySelectorAll('button[data-inline-spoiler]')).toHaveLength(1)
    expect(document.querySelector('button')?.textContent).toContain('秘密')
  })
  it.each([
    '`||代码||`', '```\n||代码||\n```', '\\|\\|原文\\|\\|', '&#124;&#124;原文&#124;&#124;',
    '[||链接||](https://example.com)', '<a href="/">||链接||</a>', '||前 **加粗** 后||', '||跨\n行||', '|||三根|||', '|| ||',
    '| 标题 |\n| --- |\n| \\|\\|表格\\|\\| |'
  ])('leaves excluded syntax alone: %s', async (source) => {
    expect(await render(source)).not.toContain('data-inline-spoiler')
  })
  it('keeps click-pinned disclosure open after hover leaves and ignores touch hover', () => {
    const dom = new JSDOM('<button data-inline-spoiler aria-expanded="false"><span data-spoiler-content aria-hidden="true">答案</span></button>')
    const prior = { Element: globalThis.Element, Node: globalThis.Node, window: globalThis.window }
    Object.assign(globalThis, { Element: dom.window.Element, Node: dom.window.Node, window: dom.window })
    Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const button = dom.window.document.querySelector('button')!
    const dispose = installInlineSpoilers(dom.window.document)
    const pointer = (type: string, pointerType: string) => {
      const event = new dom.window.Event(type, { bubbles: true })
      Object.defineProperty(event, 'pointerType', { value: pointerType })
      button.dispatchEvent(event)
    }
    try {
      pointer('pointerover', 'touch')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      pointer('pointerover', 'mouse')
      expect(button.getAttribute('aria-expanded')).toBe('true')
      pointer('pointerout', 'mouse')
      expect(button.getAttribute('aria-expanded')).toBe('false')
      pointer('pointerover', 'mouse')
      button.click()
      pointer('pointerout', 'mouse')
      expect(button.getAttribute('aria-expanded')).toBe('true')
      button.click()
      expect(button.getAttribute('aria-expanded')).toBe('false')
    } finally { dispose(); Object.assign(globalThis, prior) }
  })
  it('delegates click to inserted content and synchronizes accessibility state', () => {
    const dom = new JSDOM('<main></main>')
    const prior = { Element: globalThis.Element, Node: globalThis.Node }
    Object.assign(globalThis, { Element: dom.window.Element, Node: dom.window.Node })
    const root = dom.window.document.querySelector('main')!
    const dispose = installInlineSpoilers(root)
    try {
      root.innerHTML = '<button data-inline-spoiler aria-expanded="false" aria-label="显示隐藏文字"><span data-spoiler-content aria-hidden="true">答案</span></button>'
      const button = root.querySelector('button')!
      button.click()
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.hasAttribute('aria-label')).toBe(false)
      expect(button.querySelector('span')!.getAttribute('aria-hidden')).toBe('false')
      button.click()
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.querySelector('span')!.getAttribute('aria-hidden')).toBe('true')
    } finally { dispose(); Object.assign(globalThis, prior) }
  })
})
