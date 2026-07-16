import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_CREDENTIAL_PLACEHOLDER,
  preserveDashboardLayoutCredentialPlaceholders,
  projectDashboardLayoutValueForCopilot,
} from './read-projection'

describe('dashboard Copilot credential projection', () => {
  it('redacts stored provider credentials recursively while preserving environment references', () => {
    expect(
      projectDashboardLayoutValueForCopilot({
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
