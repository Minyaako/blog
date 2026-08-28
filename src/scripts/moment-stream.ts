export interface ParsedMomentPage {
  itemHtml: string[]
  nextHref?: string
}

function findElement(html: string, attribute: string): string | undefined {
  const startPattern = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\b${attribute}(?:=(?:"[^"]*"|'[^']*'|[^\\s>]+))?[^>]*>`, 'i')
  const start = startPattern.exec(html)
  if (!start) return undefined
  const tag = start[1]
  const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
  tokenPattern.lastIndex = start.index
  let depth = 0
  let token: RegExpExecArray | null
  while ((token = tokenPattern.exec(html))) {
    if (token[0].startsWith('</')) depth -= 1
    else if (!token[0].endsWith('/>')) depth += 1
    if (depth === 0) return html.slice(start.index, tokenPattern.lastIndex)
  }
  return undefined
}

function innerHtml(elementHtml: string): string {
  const openEnd = elementHtml.indexOf('>')
  const closeStart = elementHtml.lastIndexOf('</')
  return closeStart > openEnd ? elementHtml.slice(openEnd + 1, closeStart) : ''
}

function directChildren(html: string): string[] {
  const children: string[] = []
  let cursor = 0
  while (cursor < html.length) {
    const start = /<([a-z][\w-]*)\b[^>]*>/i.exec(html.slice(cursor))
    if (!start) break
    const absoluteStart = cursor + start.index
    const tag = start[1]
    if (start[0].endsWith('/>')) {
      children.push(start[0])
      cursor = absoluteStart + start[0].length
      continue
    }
    const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi')
    tokenPattern.lastIndex = absoluteStart
    let depth = 0
    let token: RegExpExecArray | null
    let end = -1
    while ((token = tokenPattern.exec(html))) {
      if (token[0].startsWith('</')) depth -= 1
      else if (!token[0].endsWith('/>')) depth += 1
      if (depth === 0) { end = tokenPattern.lastIndex; break }
    }
    if (end < 0) break
    children.push(html.slice(absoluteStart, end).trim())
    cursor = end
  }
  return children
}

function readAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find(Boolean)
}

export function parseMomentPage(html: string): ParsedMomentPage {
  const pageItems = findElement(html, 'data-moment-page-items')
  const nextPage = /<a\b[^>]*\bdata-next-page\b[^>]*>/i.exec(html)?.[0]
    ?? /<a\b[^>]*\bhref=[^>]*\bdata-next-page\b[^>]*>/i.exec(html)?.[0]
  const nextHref = nextPage ? readAttribute(nextPage, 'href') : undefined
  return {
    itemHtml: pageItems ? directChildren(innerHtml(pageItems)) : [],
    ...(nextHref ? { nextHref } : {})
  }
}

export function initMomentStream(root: ParentNode = document, afterAppend?: (fragment: ParentNode) => void): () => void {
  const stream = root.querySelector<HTMLElement>('[data-moment-stream]')
  const items = stream?.querySelector<HTMLElement>('[data-moment-page-items]')
  let next = root.querySelector<HTMLAnchorElement>('[data-next-page]')
  if (!stream || !items || !next || stream.dataset.streamInitialized === 'true') return () => undefined
  stream.dataset.streamInitialized = 'true'
  const previousScrollRestoration = history.scrollRestoration
  history.scrollRestoration = 'manual'

  const status = document.createElement('p')
  status.className = 'moment-stream-status'
  status.setAttribute('aria-live', 'polite')
  status.dataset.momentStreamStatus = ''
  next.before(status)
  let loading = false
  let stopped = false
  let restoreTimer: number | undefined
  const loadedPages: string[] = Array.isArray(history.state?.momentStream?.pages)
    ? [...history.state.momentStream.pages]
    : []

  const saveState = (scrollY = window.scrollY) => history.replaceState({
    ...history.state,
    momentStream: { pages: loadedPages, scrollY }
  }, '')
  const onScroll = () => saveState()
  const onPageHide = () => saveState()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('pagehide', onPageHide)

  const appendPage = async (href: string, record = true) => {
    const response = await fetch(href)
    if (!response.ok) throw new Error(`Moment page request failed: ${response.status}`)
    const parsed = parseMomentPage(await response.text())
    const template = document.createElement('template')
    template.innerHTML = parsed.itemHtml.join('')
    const existingIds = new Set(Array.from(items.querySelectorAll<HTMLElement>('[data-moment-id]')).map((item) => item.dataset.momentId))
    const existingMonths = new Set(Array.from(items.querySelectorAll<HTMLElement>('[data-month-key]')).map((item) => item.dataset.monthKey))
    template.content.querySelectorAll<HTMLElement>('[data-moment-id]').forEach((item) => {
      if (item.dataset.momentId && existingIds.has(item.dataset.momentId)) item.remove()
    })
    template.content.querySelectorAll<HTMLElement>('[data-month-key]').forEach((heading) => {
      if (heading.dataset.monthKey && existingMonths.has(heading.dataset.monthKey)) heading.remove()
    })
    afterAppend?.(template.content)
    items.append(template.content)
    if (record && !loadedPages.includes(href)) loadedPages.push(href)
    if (parsed.nextHref) {
      next!.href = parsed.nextHref
      next!.hidden = false
    } else {
      next!.remove()
      next = null
      status.textContent = '已加载全部动态'
      stopped = true
    }
    saveState()
  }

  const loadNext = async () => {
    if (loading || stopped || !next) return
    loading = true
    status.textContent = '正在加载更早的动态…'
    try {
      await appendPage(next.getAttribute('href') ?? next.href)
    } catch {
      stopped = true
      status.textContent = '自动加载失败，请使用下方链接继续。'
      next.hidden = false
      observer?.disconnect()
    } finally {
      loading = false
    }
  }

  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadNext()
      }, { rootMargin: '100% 0px' })
    : undefined
  const restore = async (event: PageTransitionEvent) => {
    const targetScrollY = history.state?.momentStream?.scrollY ?? 0
    observer?.disconnect()
    if (!event.persisted && loadedPages.length > 0) {
      loading = true
      const pages = [...loadedPages]
      loadedPages.length = 0
      try {
        for (const href of pages) await appendPage(href)
      } catch {
        stopped = true
        status.textContent = '恢复动态失败，请使用下方链接继续。'
        if (next) next.hidden = false
      } finally {
        loading = false
      }
    }
    saveState(targetScrollY)
    const restoreScroll = () => {
      document.documentElement.scrollTop = targetScrollY
      document.body.scrollTop = targetScrollY
    }
    restoreScroll()
    requestAnimationFrame(() => {
      restoreScroll()
      if (restoreTimer) window.clearTimeout(restoreTimer)
      if (event.persisted) {
        restoreTimer = window.setTimeout(restoreScroll, 50)
      }
      if (observer && next && !stopped) observer.observe(next)
    })
  }
  window.addEventListener('pageshow', restore)

  if (observer && !stopped) observer.observe(next)

  return () => {
    observer?.disconnect()
    if (restoreTimer) window.clearTimeout(restoreTimer)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('pageshow', restore)
    history.scrollRestoration = previousScrollRestoration
    delete stream.dataset.streamInitialized
  }
}
