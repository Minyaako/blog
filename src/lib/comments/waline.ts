import type { WalineInitOptions } from '@waline/client'
import type { CommentProvider } from './contracts'

const COMMENT_SERVER_URL = 'https://comments.minyako.top'

export const WALINE_OPTIONS = {
  serverURL: COMMENT_SERVER_URL,
  lang: 'zh-CN',
  meta: ['nick', 'mail'],
  requiredMeta: ['nick'],
  login: 'disable',
  imageUploader: false,
  emoji: false,
  reaction: false,
  pageview: false,
  comment: false,
  commentSorting: 'latest',
  dark: "html[data-theme='dark']",
  locale: {
    nick: '昵称（必填）',
    mail: '邮箱（选填，不公开）',
    placeholder: '支持链接、引用和代码；请友善交流。'
  }
} satisfies Omit<WalineInitOptions, 'el' | 'path'>

type WalineModule = {
  init(options: WalineInitOptions): { destroy(): void } | null
}

export interface WalineDependencies {
  load(): Promise<WalineModule>
  probe(): Promise<void>
}

const defaultDependencies: WalineDependencies = {
  load: () => import('@waline/client'),
  probe: async () => {
    const response = await fetch(COMMENT_SERVER_URL, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(5000)
    })

    if (!response.ok) {
      throw new Error(`Comment service returned ${response.status}`)
    }
  }
}

export function createWalineProvider(
  dependencies: WalineDependencies = defaultDependencies
): CommentProvider {
  let instance: { destroy(): void } | undefined
  let mounting: Promise<void> | undefined

  return {
    mount(target, pageKey) {
      if (instance) return Promise.resolve()
      if (mounting) return mounting

      mounting = (async () => {
        await dependencies.probe()
        const { init } = await dependencies.load()
        const mounted = init({ ...WALINE_OPTIONS, el: target, path: pageKey })
        if (!mounted) throw new Error('Comment client failed to initialize')
        instance = mounted
      })().finally(() => {
        mounting = undefined
      })

      return mounting
    },
    dispose() {
      instance?.destroy()
      instance = undefined
    }
  }
}
