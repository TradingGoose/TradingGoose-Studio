/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { WordRotate } from './word-rotate'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    span: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span {...props}>{children}</span>
    ),
  },
}))

describe('WordRotate', () => {
  let container: HTMLDivElement
  let root: Root
  let intervalCallbacks: Array<() => void> = []

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    intervalCallbacks = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: TimerHandler) => {
      intervalCallbacks.push(handler as () => void)
      return 1 as unknown as number
    }) as typeof setInterval)
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.restoreAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('resets the visible word when the locale copy changes', async () => {
    const esWords = getPublicCopy('es').landing.hero.leadWords
    const zhWords = getPublicCopy('zh-CN').landing.hero.leadWords

    await act(async () => {
      root.render(<WordRotate words={esWords} duration={1000} />)
    })

    expect(container.textContent).toBe(esWords[0])

    await act(async () => {
      intervalCallbacks[0]?.()
    })

    expect(container.textContent).toBe(esWords[1])

    await act(async () => {
      root.render(<WordRotate words={zhWords} duration={1000} />)
    })

    expect(container.textContent).toBe(zhWords[0])
  })
})
