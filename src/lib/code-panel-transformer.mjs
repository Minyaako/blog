const titlePattern = /(?:^|\s)(?:title|filename)=(?:"([^"]+)"|'([^']+)'|([^\s]+))/
const lineNumbersPattern = /(?:^|\s)(?:showLineNumbers|lineNumbers|show-line-numbers)(?=\s|$)/

const text = (value) => ({ type: 'text', value })

const element = (tagName, properties, children = []) => ({
  type: 'element',
  tagName,
  properties,
  children
})

const copyIcon = () => element('svg', {
  ariaHidden: 'true',
  className: ['code-panel__copy-icon'],
  fill: 'none',
  focusable: 'false',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 1.8,
  viewBox: '0 0 24 24'
}, [
  element('rect', { height: 13, rx: 2, width: 13, x: 8, y: 8 }),
  element('path', { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' })
])

function readMeta(rawMeta = '') {
  const titleMatch = titlePattern.exec(rawMeta)
  return {
    title: titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3],
    showLineNumbers: lineNumbersPattern.test(rawMeta)
  }
}

function readProperty(properties, key) {
  const value = properties?.[key]
  return Array.isArray(value) ? value.join(' ') : String(value ?? '')
}

export function transformerCodePanel() {
  return {
    name: 'minyako:code-panel',
    pre(node) {
      const meta = readMeta(this.options.meta?.__raw)
      if (meta.title) node.properties.dataTitle = meta.title
      if (meta.showLineNumbers) node.properties.dataLineNumbers = ''
    },
    root(node) {
      const pre = node.children.find((child) => child.type === 'element' && child.tagName === 'pre')
      if (!pre || pre.type !== 'element') return

      const language = readProperty(pre.properties, 'dataLanguage') || 'text'
      const title = readProperty(pre.properties, 'dataTitle')
      const identity = title || language.toUpperCase()
      const toolbarChildren = [
        element('span', { className: ['code-panel__identity'], title: identity }, [text(identity)]),
        element('span', { className: ['code-panel__actions'] }, [
          ...(title
            ? [element('span', { className: ['code-panel__language'] }, [text(language.toUpperCase())])]
            : []),
          element('button', {
            ariaLabel: '复制代码',
            className: ['code-panel__copy'],
            dataCopyCode: '',
            title: '复制代码',
            type: 'button'
          }, [
            copyIcon(),
            element('span', { dataCopyLabel: '' }, [text('复制')])
          ])
        ])
      ]

      node.children = [element('figure', {
        className: ['code-panel'],
        dataCodePanel: ''
      }, [
        element('figcaption', { className: ['code-panel__toolbar'] }, toolbarChildren),
        pre
      ])]
    }
  }
}
