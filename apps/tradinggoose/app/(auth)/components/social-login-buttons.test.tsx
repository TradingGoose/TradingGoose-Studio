/**
 * @vitest-environment jsdom
 */

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPublicCopy } from '@/i18n/public-copy'
import { SocialLoginButtons } from './social-login-buttons'

const { useLocaleMock } = vi.hoisted(() => ({
  useLocaleMock: vi.fn(() => 'es'),
}))

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    signIn: {
      social: vi.fn(),
    },
  },
}))

vi.mock('next-intl', () => ({
  useLocale: useLocaleMock,
}))

vi.mock('@/lib/auth-client', () => ({
  client: mockClient,
}))

vi.mock('@/app/fonts/inter', () => ({
  inter: { className: '' },
}))

describe('SocialLoginButtons', () => {
  let container: HTMLDivElement
  let root: Root

  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  beforeEach(() => {
    vi.clearAllMocks()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('shows a localized error alert when OAuth sign-in fails and resets loading state', async () => {
    const copy = getPublicCopy('es')

    mockClient.signIn.social.mockRejectedValueOnce(new Error('popup closed'))

    await act(async () => {
      root.render(
        <SocialLoginButtons
          githubAvailable
          googleAvailable={false}
          callbackURL='/workspace'
          isProduction={false}
        />
      )
    })

    const githubButton = container.querySelector('button')
    expect(githubButton).not.toBeNull()
    if (!githubButton) {
      throw new Error('Expected GitHub sign-in button')
    }

    expect(githubButton.textContent).toContain(copy.auth.social.github)

    await act(async () => {
      githubButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(mockClient.signIn.social).toHaveBeenCalledWith({
      provider: 'github',
      callbackURL: '/workspace',
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      copy.auth.error.default.description
    )
    expect(container.querySelector('button')?.textContent).toContain(copy.auth.social.github)
    expect(container.querySelector('button')).not.toBeDisabled()
  })
})
