/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { link } = vi.hoisted(() => ({ link: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  client: { oauth2: { link } },
}))

import { startOAuthConnectFlow } from './connect'

describe('startOAuthConnectFlow', () => {
  beforeEach(() => {
    link.mockReset()
  })

  it('rejects a resolved OAuth error', async () => {
    link.mockResolvedValue({
      data: null,
      error: { message: 'Unauthorized', status: 401, statusText: 'Unauthorized' },
    })

    await expect(
      startOAuthConnectFlow({
        providerId: 'robinhood',
        callbackURL: '/workspace/ws-1/integrations',
      })
    ).rejects.toThrow('Unauthorized')
    expect(link).toHaveBeenCalledWith({
      providerId: 'robinhood',
      callbackURL: '/workspace/ws-1/integrations',
      errorCallbackURL: '/workspace/ws-1/integrations',
    })
  })
})
