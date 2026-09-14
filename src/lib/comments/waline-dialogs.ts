import { alertDialog, confirmDialog } from '../../scripts/site-dialog'
import { readWalineCredential, WALINE_USER_KEY } from '../../scripts/ranking-waline'

type Identity = { token?: string; objectId?: string | number }

export function createWalineDialogs(signal: AbortSignal) {
  const isCurrentUser = (identity: Identity) => {
    const { credential, readable } = readWalineCredential()
    return readable && !!identity.token && credential?.token === identity.token && credential.profile.objectId === identity.objectId
  }
  return {
    isActive: () => !signal.aborted,
    isCurrentUser,
    async alert(message: string) {
      if (signal.aborted) return
      await alertDialog({ title: '评论提示', message, signal })
    },
    async confirm(identity: Identity, isSameUser: () => boolean = () => true) {
      const unchanged = () => !signal.aborted && isCurrentUser(identity) && isSameUser()
      if (!unchanged()) return false
      const pending = new AbortController()
      const abort = () => pending.abort()
      const check = () => { if (!unchanged()) abort() }
      const storage = (event: Event) => {
        const key = event instanceof StorageEvent ? event.key : (event as CustomEvent).detail?.key
        if (key == null || key === WALINE_USER_KEY) check()
      }
      signal.addEventListener('abort', abort, { once: true })
      window.addEventListener('storage', storage)
      window.addEventListener('vueuse-storage', storage)
      window.addEventListener('focus', check)
      document.addEventListener('visibilitychange', check)
      try {
        const accepted = await confirmDialog({
          title: '删除评论', message: '确定删除这条评论吗？此操作无法撤销。',
          confirmLabel: '删除', danger: true, signal: pending.signal
        })
        return accepted && !pending.signal.aborted && unchanged()
      } finally {
        signal.removeEventListener('abort', abort)
        window.removeEventListener('storage', storage)
        window.removeEventListener('vueuse-storage', storage)
        window.removeEventListener('focus', check)
        document.removeEventListener('visibilitychange', check)
      }
    }
  }
}
