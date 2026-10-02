import { describe, expect, it, vi } from 'vitest'
import {
  normalizeIndicatorInputOverrides,
  normalizeIndicatorMonitorConfig,
  toPublicIndicatorMonitorProviderConfig,
} from '@/lib/indicators/monitor-config'
import type { InputMetaMap } from '@/lib/indicators/types'

const connectionLookup = vi.hoisted(() => vi.fn())
vi.mock('@/lib/credentials/oauth', () => ({
  resolveOAuthConnectionAccountForUser: connectionLookup,
}))

const inputMeta: InputMetaMap = {
  Length: {
    title: 'Length',
    type: 'int',
    defval: 14,
  },
  Threshold: {
    title: 'Threshold',
    type: 'float',
    defval: 1.5,
  },
  Enabled: {
    title: 'Enabled',
    type: 'bool',
    defval: true,
  },
  Label: {
    title: 'Label',
    type: 'string',
    defval: 'default',
  },
}

describe('normalizeIndicatorInputOverrides', () => {
  it('persists only sparse non-default indicator input overrides', () => {
    expect(
      normalizeIndicatorInputOverrides(inputMeta, {
        Length: '20.9',
        Threshold: '2.75',
        Enabled: 'false',
        Label: 'custom',
        Missing: 'ignored',
      })
    ).toEqual({
      Length: 20,
      Threshold: 2.75,
      Enabled: false,
      Label: 'custom',
    })
  })

  it('drops default-expanded values and invalid overrides', () => {
    expect(
      normalizeIndicatorInputOverrides(inputMeta, {
        Length: '14',
        Threshold: 'bad-number',
        Enabled: 'maybe',
        Label: 'default',
      })
    ).toBeUndefined()
  })

  it('clears overrides when metadata or raw inputs are empty', () => {
    expect(normalizeIndicatorInputOverrides(undefined, { Length: 20 })).toBeUndefined()
    expect(normalizeIndicatorInputOverrides(inputMeta, {})).toBeUndefined()
  })
})

describe('normalizeIndicatorMonitorConfig', () => {
  const baseInput = {
    userId: 'editor',
    triggerBlockId: 'trigger-1',
    providerId: 'alpaca',
    interval: '1m',
    listingInput: {
      listing_type: 'default' as const,
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
    },
    indicatorId: 'rsi',
    providerParams: { feed: 'iex' },
  }
  const savedMonitor = {
    providerId: 'alpaca',
    auth: {
      encryptedSecrets: { apiKey: 'encrypted-api-key', apiSecret: 'encrypted-api-secret' },
      secretVersion: 1 as const,
    },
  }
  const oauthMonitor = {
    providerId: 'robinhood',
    providerParams: { credentialId: 'account-1' },
    connectionOwnerUserId: 'saved-owner',
  }

  it('requires complete auth even when preserving existing secrets', async () => {
    await expect(
      normalizeIndicatorMonitorConfig({
        ...baseInput,
        previousMonitor: {
          ...savedMonitor,
          auth: { encryptedSecrets: { apiKey: 'encrypted-api-key' }, secretVersion: 1 },
        },
      })
    ).rejects.toThrow('Missing required auth secret values for provider fields: apiSecret')
  })

  it('replaces stored auth when explicit auth is provided', async () => {
    const result = await normalizeIndicatorMonitorConfig({
      ...baseInput,
      authInput: {
        secrets: { apiKey: 'new-api-key' },
      },
      previousMonitor: savedMonitor,
      requireCompleteAuth: false,
    })

    expect(Object.keys(result.monitor.auth?.encryptedSecrets ?? {})).toEqual(['apiKey'])
    expect(result.monitor.auth?.encryptedSecrets?.apiKey).toEqual(expect.any(String))
    expect(result.monitor.auth?.encryptedSecrets?.apiKey).not.toBe('encrypted-api-key')
  })

  it('clears stored auth when explicit empty auth is provided and complete auth is not required', async () => {
    const result = await normalizeIndicatorMonitorConfig({
      ...baseInput,
      authInput: { secrets: {} },
      previousMonitor: savedMonitor,
      requireCompleteAuth: false,
    })

    expect(result.monitor.auth).toBeUndefined()
  })

  it('rejects incomplete explicit auth when complete auth is required', async () => {
    await expect(
      normalizeIndicatorMonitorConfig({
        ...baseInput,
        authInput: {
          secrets: { apiKey: 'new-api-key' },
        },
        previousMonitor: savedMonitor,
        requireCompleteAuth: true,
      })
    ).rejects.toThrow('Missing required auth secret values for provider fields: apiSecret')
  })

  it('still rejects missing required secrets when no previous auth is preserved', async () => {
    await expect(normalizeIndicatorMonitorConfig(baseInput)).rejects.toThrow(
      'Missing required auth secret values for provider fields: apiKey, apiSecret'
    )
  })

  it('allows polling-backed market providers through the same monitor config path', async () => {
    const result = await normalizeIndicatorMonitorConfig({
      ...baseInput,
      providerId: 'yahoo-finance',
      interval: '1m',
      providerParams: {},
    })

    expect(result.monitor.providerId).toBe('yahoo-finance')
    expect(result.monitor.interval).toBe('1m')
  })

  it.each([null, { providerId: 'alpaca', credentialOwnerUserId: 'collaborator' }])(
    'rejects an unavailable or wrong-provider personal connection: %j',
    async (connection) => {
      connectionLookup.mockResolvedValue(connection)
      await expect(
        normalizeIndicatorMonitorConfig({
          ...baseInput,
          providerId: 'robinhood',
          providerParams: { credentialId: 'account-1' },
        })
      ).rejects.toThrow('Market provider connection not found')
    }
  )

  it.each([
    ['new', undefined, 'account-1', true, 'editor'],
    ['unchanged', oauthMonitor, 'account-1', true, 'saved-owner'],
    ['equivalent credential', oauthMonitor, ' account-1 ', true, 'saved-owner'],
    ['replacement', oauthMonitor, 'account-2', true, 'editor'],
    ['deactivation', oauthMonitor, 'account-1', false, 'saved-owner'],
    [
      'missing saved owner',
      { ...oauthMonitor, connectionOwnerUserId: undefined },
      'account-1',
      true,
      undefined,
    ],
  ] as const)(
    'privately resolves the %s connection owner',
    async (_, previousMonitor, credentialId, requireCompleteAuth, expectedOwner) => {
      connectionLookup.mockReset().mockImplementation(async ({ userId }) => ({
        providerId: 'robinhood',
        credentialOwnerUserId: userId,
      }))
      const result = normalizeIndicatorMonitorConfig({
        ...baseInput,
        providerId: 'robinhood',
        providerParams: { credentialId },
        previousMonitor,
        requireCompleteAuth,
      })
      if (!expectedOwner) {
        await expect(result).rejects.toThrow('Missing market provider connection owner')
        expect(connectionLookup).not.toHaveBeenCalled()
        return
      }
      const config = await result
      expect(config.monitor.connectionOwnerUserId).toBe(expectedOwner)
      expect(toPublicIndicatorMonitorProviderConfig(config).monitor).not.toHaveProperty(
        'connectionOwnerUserId'
      )
      if (requireCompleteAuth) {
        expect(connectionLookup).toHaveBeenCalledWith({
          userId: expectedOwner,
          accountId: credentialId.trim(),
        })
      } else {
        expect(connectionLookup).not.toHaveBeenCalled()
      }
    }
  )
})
