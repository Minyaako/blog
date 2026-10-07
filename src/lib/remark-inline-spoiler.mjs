// Shared with the editor: deliberately only same-node, single-line plain text.
export function splitInlineSpoilers(value) {
  const parts = []
  const pattern = /(?<!\|)\|\|([^|\r\n]+)\|\|(?!\|)/gu
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    if (!match[1].trim()) continue
    if (match.index > cursor) parts.push({ type: 'text', value: value.slice(cursor, match.index) })
    parts.push({ type: 'spoiler', value: match[1] })
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) parts.push({ type: 'text', value: value.slice(cursor) })
  return parts
}

const excluded = new Set(['link', 'linkReference', 'image', 'imageReference', 'code', 'inlineCode', 'html', 'table', 'mdxJsxFlowElement', 'mdxJsxTextElement', 'inlineSpoiler'])

export default function remarkInlineSpoiler() {
  return (tree, file = {}) => {
    const source = typeof file.value === 'string' ? file.value : null
    const walk = (parent) => {
      if (!parent.children || excluded.has(parent.type)) return
      // In .md raw HTML tags and their text are siblings; don't create nested
      // buttons inside authored anchors/buttons or alter inline HTML semantics.
      if (parent.children.some((node) => node.type === 'html')) return
      parent.children = parent.children.flatMap((node) => {
        if (node.type !== 'text') { walk(node); return [node] }
        const start = node.position?.start?.offset
        const end = node.position?.end?.offset
        // Markdown has already unescaped text and Smartypants may have changed
        // punctuation. Guard pipes specifically, not unrelated typographic edits.
        if (source !== null && Number.isInteger(start) && Number.isInteger(end)) {
          const authored = source.slice(start, end)
          if (/\\\|/u.test(authored) || (authored.match(/\|/gu)?.length ?? 0) !== (node.value.match(/\|/gu)?.length ?? 0)) return [node]
        }
        return splitInlineSpoilers(node.value).map((part) => part.type === 'text' ? part : {
          type: 'inlineSpoiler',
          data: { hName: 'button', hProperties: { type: 'button', className: ['inline-spoiler'], 'data-inline-spoiler': '', 'aria-expanded': 'false', 'aria-label': '显示隐藏文字' } },
          children: [{ type: 'inlineSpoilerContent', data: { hName: 'span', hProperties: { 'data-spoiler-content': '', 'aria-hidden': 'true' } }, children: [{ type: 'text', value: part.value }] }]
        })
      })
    }
    walk(tree)
  }
}
