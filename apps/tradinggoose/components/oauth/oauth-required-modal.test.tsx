/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthRequiredModal } from './oauth-required-modal'

const mockStartOAuthConnectFlow = vi.fn()
const mockEnvironment = vi.hoisted(() => ({ isHosted: true }))
const mockGetBaseUrl = vi.hoisted(() => vi.fn(() => 'https://www.tradinggoose.ai'))

vi.mock('@/lib/environment', () => ({
  get isHosted() {
    return mockEnvironment.isHosted
  },
}))
vi.mock('@/lib/urls/utils', () => ({ getBaseUrl: mockGetBaseUrl }))
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
    mockEnvironment.isHosted = true
    window.history.replaceState({}, '', '/workspace/ws-1/integrations')
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
    const onConnectStart = vi.fn()
    const onConnectError = vi.fn()
    const onConnectSettled = vi.fn()
    mockStartOAuthConnectFlow.mockRejectedValueOnce(new Error('link failed'))

    act(() => {
      root.render(
        <OAuthRequiredModal
          isOpen
          onClose={onClose}
          onConnectStart={onConnectStart}
          onConnectError={onConnectError}
          onConnectSettled={onConnectSettled}
          provider='alpaca'
          toolName='Trading'
          requiredScopes={['trading', 'data']}
        />
      )
    })

    expect(document.body.textContent).toContain('Connect Alpaca Live')
    expect(document.body.textContent).toContain('Connect Alpaca Paper')
    expect(mockGetBaseUrl).not.toHaveBeenCalled()
    const paperButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Connect Alpaca Paper')
    )
    expect(paperButton).toBeTruthy()

    await act(async () => {
      paperButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConnectStart).toHaveBeenCalledTimes(1)
    expect(onConnectError).toHaveBeenCalledTimes(1)
    expect(onConnectSettled).toHaveBeenCalledTimes(1)
    expect(mockStartOAuthConnectFlow).toHaveBeenCalledWith({
      providerId: 'alpaca-paper',
      callbackURL: '/workspace/ws-1/integrations',
    })
  })

  it('shows only the hosted Robinhood connection scripts', () => {
    window.history.replaceState({}, '', '?tab=trading#accounts')
    act(() => {
      root.render(
        <OAuthRequiredModal isOpen onClose={vi.fn()} provider='robinhood' toolName='Trading' />
      )
    })

    expect(document.body.textContent).toContain(
      "curl -fsSL 'https://www.tradinggoose.ai/connect/robinhood?callbackURL=%2Fworkspace%2Fws-1%2Fintegrations%3Ftab%3Dtrading%23accounts' | sh"
    )
    expect(document.body.textContent).toContain(
      "irm 'https://www.tradinggoose.ai/connect/robinhood?callbackURL=%2Fworkspace%2Fws-1%2Fintegrations%3Ftab%3Dtrading%23accounts' | iex"
    )

    const buttons = Array.from(document.body.querySelectorAll('button'))
    expect(buttons.some((button) => button.textContent?.includes('Connect Now'))).toBe(false)
    expect(mockStartOAuthConnectFlow).not.toHaveBeenCalled()
  })

  it('uses the normal OAuth action for Robinhood on a local instance', async () => {
    window.history.replaceState({}, '', '?tab=trading#accounts')
    mockEnvironment.isHosted = false
    mockStartOAuthConnectFlow.mockResolvedValueOnce(undefined)

    act(() => {
      root.render(
        <OAuthRequiredModal isOpen onClose={vi.fn()} provider='robinhood' toolName='Trading' />
      )
    })

    const connectButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Connect Now')
    )
    expect(connectButton).toBeTruthy()
    expect(mockGetBaseUrl).not.toHaveBeenCalled()

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockStartOAuthConnectFlow).toHaveBeenCalledWith({
      providerId: 'robinhood',
      callbackURL: '/workspace/ws-1/integrations?tab=trading#accounts',
    })
  })
})
