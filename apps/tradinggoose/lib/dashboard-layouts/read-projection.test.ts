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

  it('resolves accepted placeholders from the current persisted value', () => {
    expect(
      preserveDashboardLayoutCredentialPlaceholders(
        {
          apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER,
          apiSecret: 'replacement',
          nested: [{ apiKey: DASHBOARD_CREDENTIAL_PLACEHOLDER }],
        },
        {
          apiKey: 'stored-key',
          apiSecret: 'stored-secret',
          nested: [{ apiKey: 'nested-key' }],
        }
      )
    ).toEqual({
      apiKey: 'stored-key',
      apiSecret: 'replacement',
      nested: [{ apiKey: 'nested-key' }],
    })
  })
})
