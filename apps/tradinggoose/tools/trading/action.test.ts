import { describe, expect, it } from 'vitest'
import { tradingActionTool } from '@/tools/trading/action'

const portfolioIdentity = {
  providerId: 'alpaca' as const,
  credentialId: 'credential-1',
  serviceId: 'alpaca-live',
  accountId: 'ACC-1',
}
const tradierPortfolioIdentity = {
  providerId: 'tradier' as const,
  credentialId: 'credential-2',
  serviceId: 'tradier-live',
  accountId: 'ACC-2',
}

const baseParams = {
  portfolioIdentity,
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
    expect(body).not.toHaveProperty('accessToken')
    expect(body).not.toHaveProperty('accountId')
  })

  it('maps workflow context to canonical route fields', () => {
    const body = buildBody({
      quantity: 1,
      _context: {
        executionId: 'execution-1',
        submissionSource: 'workflow',
        toolExecutionId: 'block-1',
        workflowLogId: 'log-1',
        workspaceId: 'workspace-1',
      },
    })

    expect(body).toMatchObject({
      workspaceId: 'workspace-1',
      portfolioIdentity,
      submissionSource: 'workflow',
      logId: 'log-1',
      idempotencyKey: expect.stringMatching(/^trading-order:workflow:block-1:/),
    })
    expect(body).not.toHaveProperty('workflowId')
    expect(body).not.toHaveProperty('workflowExecutionId')
  })

  it('keys identical workflow orders by block tool execution identity', () => {
    const first = buildBody({
      quantity: 1,
      _context: {
        submissionSource: 'workflow',
        toolExecutionId: 'block-1',
        workspaceId: 'workspace-1',
      },
    })
    const second = buildBody({
      quantity: 1,
      _context: {
        submissionSource: 'workflow',
        toolExecutionId: 'block-2',
        workspaceId: 'workspace-1',
      },
    })

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
  })

  it('requires a tool execution identity for sourced order submissions', () => {
    expect(() =>
      buildBody({
        quantity: 1,
        _context: {
          submissionSource: 'workflow',
          workspaceId: 'workspace-1',
        },
      })
    ).toThrow('Trading order submission requires tool execution identity')
  })

  it('keys copilot orders by tool call identity', () => {
    const body = buildBody({
      quantity: 1,
      _context: {
        submissionSource: 'copilot',
        toolExecutionId: 'tool-call-1',
        workspaceId: 'workspace-1',
      },
    })

    expect(body.idempotencyKey).toEqual(
      expect.stringMatching(/^trading-order:copilot:tool-call-1:/)
    )
  })

  it('forwards canonical sizing fields without provider-name stripping', () => {
    const body = buildBody({
      portfolioIdentity: tradierPortfolioIdentity,
      quantity: 2,
      orderSizingMode: 'notional',
      notional: 100,
    })

    expect(body).toMatchObject({
      portfolioIdentity: tradierPortfolioIdentity,
      orderSizingMode: 'notional',
      notional: 100,
    })
    expect(body).not.toHaveProperty('quantity')
  })

  it('uses the canonical order submission route', () => {
    expect(tradingActionTool.request.url).toBe('/api/providers/trading/order')
    expect(tradingActionTool.directExecution).toBeUndefined()
  })

  it('declares workspace write execution policy on the tool config', () => {
    expect(tradingActionTool.execution).toEqual({
      workspace: { required: true, access: 'write' },
      submissionSource: 'required',
    })
  })

  it('transforms canonical route responses into tool output', async () => {
    const result = await tradingActionTool.transformResponse?.(
      new Response(
        JSON.stringify({
          appOrderId: 'app-order-1',
          clientOrderId: 'client-order-1',
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
        clientOrderId: 'client-order-1',
        order: { id: 'provider-order-1', status: 'accepted' },
      },
    })
  })
})
