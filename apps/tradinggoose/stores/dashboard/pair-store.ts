import { create } from 'zustand'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { PairColor } from '@/widgets/pair-colors'
import { PAIR_COLORS } from '@/widgets/pair-colors'

export type PairReviewTarget = {
  reviewSessionId?: string | null
  reviewEntityKind?: string | null
  reviewEntityId?: string | null
  reviewDraftSessionId?: string | null
}

export type PairColorContext = {
  workflowId?: string
  listing?: ListingIdentity | null
  updatedAt?: number
  channelId?: string
  reviewTarget?: PairReviewTarget | null
  indicatorId?: string | null
  mcpServerId?: string | null
  customToolId?: string | null
  skillId?: string | null
}

const PAIR_CONTEXT_KEYS = [
  'workflowId',
  'listing',
  'channelId',
  'reviewTarget',
  'indicatorId',
  'mcpServerId',
  'customToolId',
  'skillId',
] as const

interface PairStoreState {
  contexts: Record<PairColor, PairColorContext>
  setContext: (color: PairColor, ctx: PairColorContext) => void
  resetContext: (color: PairColor) => void
}

const emptyContexts = PAIR_COLORS.reduce<Record<PairColor, PairColorContext>>(
  (acc, color) => {
    acc[color] = {}
    return acc
  },
  {} as Record<PairColor, PairColorContext>
)

function sanitizePairColorContext(ctx: PairColorContext): PairColorContext {
  return Object.fromEntries(
    Object.entries(ctx).filter(([key]) =>
      (PAIR_CONTEXT_KEYS as readonly string[]).includes(key)
    )
  ) as PairColorContext
}

export const usePairColorStore = create<PairStoreState>((set) => ({
  contexts: emptyContexts,
  setContext: (color, ctx) =>
    set((state) => {
      const nextContext = sanitizePairColorContext(ctx)
      const previous = state.contexts[color]

      let next: PairColorContext = {
        ...previous,
        ...nextContext,
        updatedAt: Date.now(),
      }

      // Deep-merge reviewTarget so callers can update individual fields
      if ('reviewTarget' in nextContext && nextContext.reviewTarget != null) {
        next.reviewTarget = { ...previous.reviewTarget, ...nextContext.reviewTarget }
      }

      if (nextContext.reviewTarget === null) {
        const { reviewTarget: _removed, ...rest } = next
        next = rest
      }

      return {
        contexts: {
          ...state.contexts,
          [color]: next,
        },
      }
    }),
  resetContext: (color) =>
    set((state) => ({
      contexts: {
        ...state.contexts,
        [color]: {},
      },
    })),
}))

export const usePairColorContext = (color: PairColor) =>
  usePairColorStore((state) => state.contexts[color])

export const useSetPairColorContext = () => usePairColorStore((state) => state.setContext)
