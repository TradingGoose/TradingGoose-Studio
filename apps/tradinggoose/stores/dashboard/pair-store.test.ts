import { beforeEach, describe, expect, it } from 'vitest'
import { type PairColorContext, usePairColorStore } from '@/stores/dashboard/pair-store'
import { PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'

function resetPairContexts() {
  usePairColorStore.setState({
    contexts: Object.fromEntries(PAIR_COLORS.map((color) => [color, {}])) as Record<
      PairColor,
      PairColorContext
    >,
  })
}

describe('pair-store linked context', () => {
  beforeEach(() => {
    resetPairContexts()
  })

  it('ignores unsupported shared keys instead of persisting them', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      channelId: 'pair-blue',
      reviewTarget: {
        reviewSessionId: 'review-a',
      },
      copilotChatId: 'legacy-review-session',
    } as PairColorContext & {
      channelId?: string
      reviewTarget?: { reviewSessionId?: string | null }
      copilotChatId?: string
    })

    const context = usePairColorStore.getState().contexts.blue as PairColorContext & {
      channelId?: string
      reviewTarget?: unknown
      copilotChatId?: string
    }

    expect(context).toEqual({
      workflowId: 'workflow-a',
    })
    expect(context.channelId).toBeUndefined()
    expect(context.reviewTarget).toBeUndefined()
    expect(context.copilotChatId).toBeUndefined()
  })

  it('stores only canonical listing identity fields in linked color context', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      listing: {
        listing_id: 'AAPL',
        base_id: 'ignored-base',
        quote_id: 'ignored-quote',
        listing_type: 'default',
        provider: 'alpaca',
        marketProvider: 'polygon',
        accountId: 'acct-1',
        providerParams: { apiKey: 'secret' },
      } as PairColorContext['listing'] & {
        provider: string
        marketProvider: string
        accountId: string
        providerParams: Record<string, unknown>
      },
    })

    const listing = usePairColorStore.getState().contexts.blue.listing

    expect(listing).toEqual({
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
    expect(listing).not.toHaveProperty('provider')
    expect(listing).not.toHaveProperty('marketProvider')
    expect(listing).not.toHaveProperty('accountId')
    expect(listing).not.toHaveProperty('providerParams')
  })

  it('preserves allowed shared ids when workflow selection changes', () => {
    const { setContext } = usePairColorStore.getState()

    setContext('blue', {
      workflowId: 'workflow-a',
      skillId: 'skill-a',
      customToolId: 'tool-a',
      mcpServerId: 'mcp-a',
      indicatorId: 'indicator-a',
    })

    setContext('blue', {
      workflowId: 'workflow-b',
    })

    expect(usePairColorStore.getState().contexts.blue).toEqual({
      workflowId: 'workflow-b',
      skillId: 'skill-a',
      customToolId: 'tool-a',
      mcpServerId: 'mcp-a',
      indicatorId: 'indicator-a',
    })
  })

  it('strips stale unsupported keys that were already present before the next write', () => {
    usePairColorStore.setState((state) => ({
      contexts: {
        ...state.contexts,
        blue: {
          workflowId: 'workflow-a',
          skillId: 'skill-a',
          reviewTarget: {
            reviewSessionId: 'review-a',
          },
          channelId: 'pair-blue',
        } as PairColorContext & {
          reviewTarget?: { reviewSessionId?: string | null }
          channelId?: string
        },
      },
    }))

    usePairColorStore.getState().setContext('blue', {
      indicatorId: 'indicator-b',
    })

    const context = usePairColorStore.getState().contexts.blue as PairColorContext & {
      reviewTarget?: unknown
      channelId?: string
    }

    expect(context).toEqual({
      workflowId: 'workflow-a',
      skillId: 'skill-a',
      indicatorId: 'indicator-b',
    })
    expect(context.reviewTarget).toBeUndefined()
    expect(context.channelId).toBeUndefined()
  })
})
