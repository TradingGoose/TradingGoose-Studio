/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { MarketProviderError, normalizeMarketProviderError } from '@/providers/market/errors'

const brokerError = (status: number) =>
  Object.assign(new Error(`Broker request failed with status ${status}`), {
    name: 'TradingBrokerRequestError',
    status,
    providerId: 'ibkr',
    url: 'http://host.containers.internal:5002/v1/api/iserver/accounts',
    payload: { error: `broker rejected the request with ${status}` },
  })

describe('normalizeMarketProviderError', () => {
  it('preserves the broker status, url and payload', () => {
    const normalized = normalizeMarketProviderError(brokerError(400), 'ibkr')

    expect(normalized).toBeInstanceOf(MarketProviderError)
    expect(normalized.code).toBe('PROVIDER ERROR')
    expect(normalized.status).toBe(400)
    expect(normalized.provider).toBe('ibkr')
    expect(normalized.details).toMatchObject({
      brokerStatus: 400,
      url: 'http://host.containers.internal:5002/v1/api/iserver/accounts',
      payload: { error: 'broker rejected the request with 400' },
    })
  })

  it('turns an unauthenticated IBKR gateway into an instruction', () => {
    const normalized = normalizeMarketProviderError(brokerError(401), 'ibkr')

    expect(normalized.status).toBe(401)
    expect(normalized.message).toContain('Broker request failed with status 401')
    expect(normalized.message).toContain('log in at the gateway URL')
  })

  it('does not attach the session hint to a non-auth failure', () => {
    const normalized = normalizeMarketProviderError(brokerError(400), 'ibkr')

    expect(normalized.message).not.toContain('log in at the gateway URL')
  })

  it('uses a credential hint for a non-IBKR provider', () => {
    const error = Object.assign(new Error('Broker request failed with status 401'), {
      status: 401,
      providerId: 'alpaca',
      url: 'https://api.alpaca.markets/v2/account',
    })

    const normalized = normalizeMarketProviderError(error, 'alpaca')

    expect(normalized.message).toContain('rejected the credentials or session')
    expect(normalized.message).not.toContain('Client Portal Gateway')
  })

  it('still maps a plain error without a status', () => {
    const normalized = normalizeMarketProviderError(new Error('boom'), 'ibkr')

    expect(normalized.status).toBeUndefined()
    expect(normalized.message).toBe('boom')
  })

  it('does not treat an object without a providerId as a broker error', () => {
    const normalized = normalizeMarketProviderError({ status: 401, message: 'x' }, 'ibkr')

    expect(normalized.status).toBeUndefined()
    expect(normalized.message).toBe('Market provider error')
  })
})
