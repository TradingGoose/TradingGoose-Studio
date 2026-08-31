import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_CREDENTIAL_PLACEHOLDER,
  preserveDashboardLayoutCredentialPlaceholders,
  redactDashboardLayoutCredentials,
  serializeDashboardLayoutForCopilot,
} from './read-projection'

describe('dashboard Copilot projection', () => {
  it('projects effective widget params without exposing color-pair ownership', () => {
    const listing = (listing_id: string) => ({
      listing_id,
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    })
    const projected = JSON.parse(
      serializeDashboardLayoutForCopilot({
        layout: {
          id: 'panel-1',
          type: 'panel',
          identityId: 'chart-1',
          widgetKey: 'data_chart',
        },
        widgets: {
          'chart-1': {
            pairColor: 'blue',
            params: { listing: listing('LOCAL'), data: { provider: 'yahoo-finance' } },
          },
        },
        colorPairs: { pairs: [{ color: 'blue', listing: listing('SHARED') }] },
      })
    )

    expect(projected.widgets['chart-1'].params).toEqual({
      listing: listing('SHARED'),
      data: { provider: 'yahoo-finance' },
    })
    expect(projected).not.toHaveProperty('colorPairs')
    expect(projected.widgets['chart-1']).not.toHaveProperty('pairColor')
  })

  it('redacts stored provider credentials recursively while preserving environment references', () => {
    expect(
      redactDashboardLayoutCredentials({
        apiKey: 'plain-key',
        nested: [{ apiSecret: 'plain-secret' }, { apiKey: '{{MARKET_API_KEY}}' }],
      })
    ).toEqual({
      apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER,
      nested: [{ apiSecret: DASHBOARD_CREDENTIAL_PLACEHOLDER }, { apiKey: '{{MARKET_API_KEY}}' }],
    })
  })

  it('resolves accepted placeholders from stable-id records after reordering', () => {
    expect(
      preserveDashboardLayoutCredentialPlaceholders(
        {
          auth: {
            apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER,
            apiSecret: 'replacement',
          },
          indicators: [
            { id: 'indicator-b', inputs: { apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER } },
            { id: 'indicator-a', inputs: { apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER } },
          ],
        },
        {
          auth: { apiKey: 'flat-key', apiSecret: 'old-secret' },
          indicators: [
            { id: 'indicator-a', inputs: { apiKey: 'key-a' } },
            { id: 'indicator-b', inputs: { apiKey: 'key-b' } },
          ],
        }
      )
    ).toEqual({
      auth: { apiKey: 'flat-key', apiSecret: 'replacement' },
      indicators: [
        { id: 'indicator-b', inputs: { apiKey: 'key-b' } },
        { id: 'indicator-a', inputs: { apiKey: 'key-a' } },
      ],
    })
  })

  it('rejects a preservation placeholder without a matching stored credential', () => {
    expect(() =>
      preserveDashboardLayoutCredentialPlaceholders(
        {
          indicators: [
            { id: 'indicator-new', inputs: { apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER } },
          ],
        },
        { indicators: [{ id: 'indicator-a', inputs: { apiKey: 'key-a' } }] }
      )
    ).toThrow('params.indicators.0.inputs.apiKey: Cannot preserve a missing credential value')
  })
})
