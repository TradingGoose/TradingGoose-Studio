/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getEffectiveDecryptedEnvMock } = vi.hoisted(() => ({
  getEffectiveDecryptedEnvMock: vi.fn(),
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: getEffectiveDecryptedEnvMock,
}))

vi.mock('@/lib/listing/identity', () => ({
  areListingIdentitiesEqual: vi.fn(() => false),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/providers/market/alpaca/config', () => ({
  alpacaProviderConfig: {},
}))

vi.mock('@/providers/market/finnhub/config', () => ({
  finnhubProviderConfig: {},
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: vi.fn(),
  resolveProviderSymbol: vi.fn(),
}))

vi.mock('@/socket-server/market/alpaca', () => ({
  AlpacaMarketStream: class {},
}))

vi.mock('@/socket-server/market/finnhub', () => ({
  FinnhubMarketStream: class {},
}))

import { resolveMarketSubscribeEnv, type MarketSubscribePayload } from './manager'

describe('resolveMarketSubscribeEnv', () => {
  const originalEnv = process.env.RUNTIME_ONLY_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.RUNTIME_ONLY_KEY
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RUNTIME_ONLY_KEY
      return
    }

    process.env.RUNTIME_ONLY_KEY = originalEnv
  })

  it('resolves auth and provider params from user/workspace env placeholders', async () => {
    getEffectiveDecryptedEnvMock.mockResolvedValue({
      ALPACA_API_KEY: 'workspace-key',
      ALPACA_API_SECRET: 'workspace-secret',
      ALPACA_FEED: 'sip',
    })

    const payload: MarketSubscribePayload = {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      auth: {
        apiKey: '{{ ALPACA_API_KEY }}',
        apiSecret: 'token-{{ALPACA_API_SECRET}}',
      },
      providerParams: {
        feed: '{{ ALPACA_FEED }}',
      },
    }

    await expect(resolveMarketSubscribeEnv(payload, 'user-1')).resolves.toEqual({
      ...payload,
      auth: {
        apiKey: 'workspace-key',
        apiSecret: 'token-workspace-secret',
      },
      providerParams: {
        feed: 'sip',
      },
    })

    expect(getEffectiveDecryptedEnvMock).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('does not fall back to deployment env when placeholders are missing', async () => {
    process.env.RUNTIME_ONLY_KEY = 'deployment-secret'
    getEffectiveDecryptedEnvMock.mockResolvedValue({})

    const payload: MarketSubscribePayload = {
      provider: 'finnhub',
      workspaceId: 'workspace-1',
      auth: {
        apiKey: '{{ RUNTIME_ONLY_KEY }}',
      },
    }

    await expect(resolveMarketSubscribeEnv(payload, 'user-1')).rejects.toThrow(
      'Missing required environment variable: RUNTIME_ONLY_KEY'
    )
    expect(getEffectiveDecryptedEnvMock).toHaveBeenCalledWith('user-1', 'workspace-1')
  })
})
