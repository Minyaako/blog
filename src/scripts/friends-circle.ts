import type { FriendArticle } from '../lib/friends-feed-parser'

const INITIAL_ARTICLE_COUNT = 6

function mountFriendCopy() {
  const button = document.querySelector<HTMLButtonElement>('[data-copy-friend]')
  if (!button || button.dataset.mounted) return
  button.dataset.mounted = 'true'
  button.addEventListener('click', async () => {
    const fallback = document.querySelector<HTMLTextAreaElement>('[data-copy-fallback]')!
    const status = document.querySelector<HTMLElement>('[data-copy-status]')!
    try {
      await navigator.clipboard.writeText(fallback.value)
      fallback.hidden = true
      status.textContent = '已复制，可以发给朋友啦。'
    } catch {
      fallback.hidden = false
      fallback.focus()
      fallback.select()
      status.textContent = '自动复制未能完成，请复制下方选中的信息。'
    }
  })
}

async function mountFriendsCircle() {
  const root = document.querySelector<HTMLElement>('[data-friends-circle]')
  if (!root || root.dataset.mounted) return
  root.dataset.mounted = 'true'
  const status = root.querySelector<HTMLElement>('[data-feed-status]')!
  const list = root.querySelector<HTMLOListElement>('[data-feed-list]')!
  const toggle = root.querySelector<HTMLButtonElement>('[data-feed-toggle]')!
  try {
    const response = await fetch('/friends/feeds.json', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('Feed snapshot unavailable')
    const snapshot = await response.json() as { generatedAt: string; failed: number; articles: FriendArticle[] }
    const { articles, failed } = snapshot
    for (const article of articles) {
      const item = document.createElement('li')
      item.hidden = list.children.length >= INITIAL_ARTICLE_COUNT
      const link = document.createElement('a')
      link.href = article.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = article.title
      const meta = document.createElement('p')
      meta.textContent = article.friend
      if (article.date) {
        const time = document.createElement('time')
        time.dateTime = article.date
        time.textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(article.date))
        meta.append(' · ', time)
      }
      item.append(meta, link)
      list.append(item)
    }
    if (articles.length > INITIAL_ARTICLE_COUNT) {
      toggle.hidden = false
      const remaining = articles.length - INITIAL_ARTICLE_COUNT
      toggle.textContent = `展开更多（${remaining} 篇）`
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') !== 'true'
        toggle.setAttribute('aria-expanded', String(expanded))
        toggle.textContent = expanded ? '收起动态' : `展开更多（${remaining} 篇）`
        Array.from(list.children).forEach((item, index) => {
          (item as HTMLElement).hidden = !expanded && index >= INITIAL_ARTICLE_COUNT
        })
        if (!expanded) toggle.scrollIntoView({ block: 'nearest' })
      })
    }
    const updated = new Date(snapshot.generatedAt)
    const date = Number.isFinite(updated.getTime()) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(updated) : ''
    status.textContent = [articles.length ? `最近 ${articles.length} 篇文章` : '还没有可显示的新文章。', failed ? `${failed} 个订阅源暂时未能读取，下次更新时会再试。` : '', date ? `更新于 ${date}` : ''].filter(Boolean).join(' · ')
  } catch {
    status.textContent = '朋友圈暂时未能加载，可以先从上方友链去朋友家坐坐。'
  }
}

void mountFriendsCircle()
mountFriendCopy()
document.addEventListener('astro:page-load', () => { void mountFriendsCircle(); mountFriendCopy() })
