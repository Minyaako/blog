import { describe, expect, it, vi } from 'vitest'
import { WALINE_OPTIONS, createWalineProvider } from '../../src/lib/comments/waline'

describe('Waline comment provider', () => {
  it('mounts the reusable login and emoji client with the permanent page key', async () => {
    const destroy = vi.fn()
    const init = vi.fn(() => ({ destroy }))
    const probe = vi.fn().mockResolvedValue(undefined)
    const provider = createWalineProvider({
      load: async () => ({ init }),
      probe
    })
    const target = {} as HTMLElement

    await provider.mount(target, 'engineering-astro-content-architecture')

    expect(probe).toHaveBeenCalledOnce()
    expect(init).toHaveBeenCalledWith({
      ...WALINE_OPTIONS,
      el: target,
      path: 'engineering-astro-content-architecture'
    })
    expect(WALINE_OPTIONS).toMatchObject({
      serverURL: 'https://comments.minyako.top',
      lang: 'zh-CN',
      meta: ['nick', 'mail'],
      requiredMeta: ['nick'],
      login: 'enable',
      imageUploader: false,
      emoji: ['https://gsk.minyako.top/comments/emoji/tw-emoji'],
      reaction: false,
      pageview: false,
      commentSorting: 'latest'
    })
    expect(WALINE_OPTIONS).not.toHaveProperty('turnstileKey')
    expect(WALINE_OPTIONS).not.toHaveProperty('recaptchaV3Key')
  })

  it('mounts once and destroys the active client', async () => {
    const destroy = vi.fn()
    const init = vi.fn(() => ({ destroy }))
    const provider = createWalineProvider({
      load: async () => ({ init }),
      probe: vi.fn().mockResolvedValue(undefined)
    })
    const target = {} as HTMLElement

    await provider.mount(target, 'post-id')
    await provider.mount(target, 'post-id')
    provider.dispose()

    expect(init).toHaveBeenCalledTimes(1)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('allows a clean retry after the availability probe fails', async () => {
    const destroy = vi.fn()
    const init = vi.fn(() => ({ destroy }))
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const provider = createWalineProvider({
      load: async () => ({ init }),
      probe
    })
    const target = {} as HTMLElement

    await expect(provider.mount(target, 'post-id')).rejects.toThrow('offline')
    await provider.mount(target, 'post-id')

    expect(probe).toHaveBeenCalledTimes(2)
    expect(init).toHaveBeenCalledOnce()
  })
})
