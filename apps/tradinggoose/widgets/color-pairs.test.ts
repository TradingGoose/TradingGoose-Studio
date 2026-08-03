import { describe, expect, it } from 'vitest'
import {
  createDefaultColorPairsState,
  type PairColorContext,
  readPairColorContext,
  upsertPairColorContext,
} from '@/widgets/color-pairs'

type LoosePairContext = PairColorContext & { channelId?: string }

describe('color-pair linked context helpers', () => {
  it('ignores unsupported shared keys instead of persisting them', () => {
    const state = upsertPairColorContext(createDefaultColorPairsState(), 'blue', {
      workflowId: 'workflow-a',
      channelId: 'pair-blue',
    } as LoosePairContext)

    const context = readPairColorContext(state, 'blue') as LoosePairContext

    expect(context).toEqual({ workflowId: 'workflow-a' })
    expect(context.channelId).toBeUndefined()
  })

  it('rejects noncanonical listing values in linked color context', () => {
    const state = upsertPairColorContext(createDefaultColorPairsState(), 'blue', {
      listing: {
        listing_id: 'AAPL',
        base_id: 'ignored-base',
        quote_id: 'ignored-quote',
        listing_type: 'default',
        provider: 'alpaca',
        marketProvider: 'polygon',
        accountId: 'acct-1',
        providerParams: { apiKey: 'secret' },
      } as unknown as PairColorContext['listing'],
    })

    const listing = readPairColorContext(state, 'blue').listing

    expect(listing).toBeUndefined()
  })

  it('preserves untouched shared entity ids while patched ids change', () => {
    const initial = upsertPairColorContext(createDefaultColorPairsState(), 'blue', {
      workflowId: 'workflow-a',
      skillId: 'skill-a',
    })

    expect(
      readPairColorContext(
        upsertPairColorContext(initial, 'blue', { workflowId: 'workflow-b' }),
        'blue'
      )
    ).toEqual({
      workflowId: 'workflow-b',
      skillId: 'skill-a',
    })
    expect(
      readPairColorContext(
        upsertPairColorContext(initial, 'blue', { indicatorId: 'indicator-a' }),
        'blue'
      )
    ).toEqual({
      workflowId: 'workflow-a',
      skillId: 'skill-a',
      indicatorId: 'indicator-a',
    })
  })

  it('strips stale unsupported keys that were already present before the next write', () => {
    const state = upsertPairColorContext(
      {
        pairs: [
          {
            color: 'blue',
            workflowId: 'workflow-a',
            skillId: 'skill-a',
            channelId: 'pair-blue',
          } as LoosePairContext & { color: 'blue' },
        ],
      },
      'blue',
      { indicatorId: 'indicator-b' }
    )

    const context = readPairColorContext(state, 'blue') as LoosePairContext

    expect(context).toEqual({
      workflowId: 'workflow-a',
      skillId: 'skill-a',
      indicatorId: 'indicator-b',
    })
    expect(context.channelId).toBeUndefined()
  })

  it('uses absence as the only representation for an empty shared context', () => {
    const colorOnly = {
      pairs: [{ color: 'blue' as const }],
    }

    expect(readPairColorContext(colorOnly, 'blue')).toEqual({})
    expect(upsertPairColorContext(colorOnly, 'blue', {})).toEqual({ pairs: [] })

    const configured = upsertPairColorContext(colorOnly, 'blue', {
      workflowId: 'workflow-a',
    })
    expect(
      upsertPairColorContext(configured, 'blue', {
        workflowId: null,
      })
    ).toEqual({ pairs: [] })
  })
})
