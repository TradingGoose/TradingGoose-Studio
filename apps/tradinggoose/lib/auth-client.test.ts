/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAuthClient: vi.fn((config: unknown) => ({ config })),
}))

vi.mock('better-auth/react', () => ({
  createAuthClient: mocks.createAuthClient,
}))

vi.mock('@better-auth/sso/client', () => ({
  ssoClient: vi.fn(() => 'sso-client'),
}))

vi.mock('@better-auth/stripe/client', () => ({
  stripeClient: vi.fn(() => 'stripe-client'),
}))

vi.mock('better-auth/client/plugins', () => ({
  customSessionClient: vi.fn(() => 'custom-session-client'),
  emailOTPClient: vi.fn(() => 'email-otp-client'),
  genericOAuthClient: vi.fn(() => 'generic-oauth-client'),
  organizationClient: vi.fn(() => 'organization-client'),
}))

vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SSO_ENABLED: false,
  },
}))

vi.mock('@/lib/session/session-context', () => ({
  SessionContext: null,
}))

describe('auth client', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.createAuthClient.mockClear()
  })

  it('uses the browser origin for same-origin auth requests', async () => {
    await import('./auth-client')

    expect(mocks.createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: window.location.origin,
      })
    )
  })
})
