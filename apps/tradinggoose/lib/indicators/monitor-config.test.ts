import { describe, expect, it } from 'vitest'
import {
  normalizeIndicatorInputOverrides,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import type { InputMetaMap } from '@/lib/indicators/types'

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
    triggerBlockId: 'trigger-1',
    providerId: 'alpaca',
    interval: '1m',
    listingInput: {
      listing_type: 'default',
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
    },
    indicatorId: 'rsi',
    providerParams: { feed: 'iex' },
  }

  it('preserves existing partial auth without rechecking newly required secrets', async () => {
    await expect(
      normalizeIndicatorMonitorConfig({
        ...baseInput,
        previousAuth: {
          encryptedSecrets: { apiKey: 'encrypted-api-key' },
          secretVersion: 1,
        },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        monitor: expect.objectContaining({
          auth: {
            encryptedSecrets: { apiKey: 'encrypted-api-key' },
            secretVersion: 1,
          },
        }),
      })
    )
  })

  it('still rejects missing required secrets when no previous auth is preserved', async () => {
    await expect(normalizeIndicatorMonitorConfig(baseInput)).rejects.toThrow(
      'Missing required auth secret values for provider fields: apiKey, apiSecret'
    )
  })
})
