/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { linkSocial } = vi.hoisted(() => ({ linkSocial: vi.fn() }))

vi.mock('@/lib/auth-client', () => ({
  client: { linkSocial },
}))

import { startOAuthConnectFlow } from './connect'

describe('startOAuthConnectFlow', () => {
  beforeEach(() => {
    linkSocial.mockReset()
  })

  it('rejects a resolved OAuth error', async () => {
    linkSocial.mockResolvedValue({
      data: null,
      error: { message: 'Unauthorized', status: 401, statusText: 'Unauthorized' },
    })

    await expect(
      startOAuthConnectFlow({
        providerId: 'robinhood',
        callbackURL: '/workspace/ws-1/integrations',
      })
    ).rejects.toThrow('Unauthorized')
    expect(linkSocial).toHaveBeenCalledWith({
      provider: 'robinhood',
      callbackURL: '/workspace/ws-1/integrations',
      errorCallbackURL: '/workspace/ws-1/integrations',
    })
  })
})
