import { describe, expect, it } from 'vitest'
import { tradingActionTool } from '@/tools/trading/action'

const portfolioIdentity = {
  providerId: 'alpaca' as const,
  credentialId: 'credential-1',
  credentialServiceId: 'alpaca-live',
  accountId: 'ACC-1',
}

const baseParams = {
  provider: 'alpaca' as const,
  portfolioIdentity,
  credential: 'credential-1',
  listing: {
    listing_type: 'default' as const,
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
    base: 'AAPL',
    quote: 'USD',
    assetClass: 'stock',
  },
  side: 'buy' as const,
  orderType: 'market' as const,
  timeInForce: 'day' as const,
  accessToken: 'test-token',
}

const requestBodyBuilder = tradingActionTool.request?.body
if (!requestBodyBuilder) {
  throw new Error('tradingActionTool request body builder is not configured')
}

const buildBody = (overrides: Record<string, unknown> = {}) =>
  requestBodyBuilder({
    ...baseParams,
    ...overrides,
  } as any) as Record<string, any>

describe('tradingActionTool canonical order route payload', () => {
  it('builds the canonical order route payload without broker execution fields', () => {
    const body = buildBody({
      quantity: 2,
    })

    expect(body).toMatchObject({
      portfolioIdentity,
      side: 'buy',
      orderType: 'market',
      timeInForce: 'day',
      quantity: 2,
    })
    expect(body).not.toHaveProperty('credential')
    expect(body).not.toHaveProperty('accountId')
  })

  it('maps workflow context to canonical route fields without workflow identity aliases', () => {
    const body = buildBody({
      quantity: 1,
      _context: {
        submissionSource: 'workflow',
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
      },
    })

    expect(body).toMatchObject({
      workspaceId: 'workspace-1',
      portfolioIdentity,
      accessToken: 'test-token',
      submissionSource: 'workflow',
      logId: 'log-1',
    })
    expect(body).not.toHaveProperty('workflowId')
    expect(body).not.toHaveProperty('workflowExecutionId')
  })

  it('uses the canonical order submission route', () => {
    expect(tradingActionTool.request.url).toBe('/api/providers/trading/order')
    expect(tradingActionTool.directExecution).toBeUndefined()
  })

  it('transforms canonical route responses into tool output', async () => {
    const result = await tradingActionTool.transformResponse?.(
      new Response(
        JSON.stringify({
          appOrderId: 'app-order-1',
          provider: 'alpaca',
          order: { id: 'provider-order-1', status: 'accepted' },
        })
      )
    )

    expect(result).toMatchObject({
      success: true,
      output: {
        provider: 'alpaca',
        appOrderId: 'app-order-1',
        order: { id: 'provider-order-1', status: 'accepted' },
      },
    })
  })
})
