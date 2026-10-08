/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthRequiredModal } from './oauth-required-modal'

const mockStartOAuthConnectFlow = vi.fn()

vi.mock('@/lib/environment', () => ({ isHosted: true }))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: () => 'https://www.tradinggoose.ai' }))
vi.mock('@/lib/oauth/connect', () => ({
  startOAuthConnectFlow: (...args: unknown[]) => mockStartOAuthConnectFlow(...args),
}))

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/workspace/ws-1/integrations',
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
      callbackURL: '/workspace/ws-1/integrations',
    })
  })

  it('shows the hosted Robinhood helper before starting the canonical OAuth flow', async () => {
    act(() => {
      root.render(
        <OAuthRequiredModal isOpen onClose={vi.fn()} provider='robinhood' toolName='Trading' />
      )
    })

    expect(document.body.textContent).toContain(
      'curl -fsSL https://www.tradinggoose.ai/connect/robinhood | sh'
    )
    expect(document.body.textContent).toContain(
      'irm https://www.tradinggoose.ai/connect/robinhood | iex'
    )

    const connectButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Connect Now')
    )
    expect(connectButton).toBeTruthy()

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockStartOAuthConnectFlow).toHaveBeenCalledWith({
      providerId: 'robinhood',
      callbackURL: '/workspace/ws-1/integrations',
    })
  })
})
