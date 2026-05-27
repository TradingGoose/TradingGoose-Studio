/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthRequiredModal } from './oauth-required-modal'

const mockStartOAuthConnectFlow = vi.fn()

vi.mock('@/lib/oauth/connect', () => ({
  startOAuthConnectFlow: (...args: unknown[]) => mockStartOAuthConnectFlow(...args),
}))

describe('OAuthRequiredModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    document.body.replaceChildren()
  })

  it('requires an explicit Alpaca live or paper connection when scopes match both services', async () => {
    const onClose = vi.fn()

    act(() => {
      root.render(
        <OAuthRequiredModal
          isOpen
          onClose={onClose}
          provider='alpaca'
          toolName='Trading'
          requiredScopes={['trading', 'data']}
        />
      )
    })

    expect(document.body.textContent).toContain('Connect Alpaca Live')
    expect(document.body.textContent).toContain('Connect Alpaca Paper')

    const paperButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Connect Alpaca Paper')
    )
    expect(paperButton).toBeTruthy()

    await act(async () => {
      paperButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockStartOAuthConnectFlow).toHaveBeenCalledWith({
      providerId: 'alpaca-paper',
      callbackURL: window.location.href,
    })
  })
})
