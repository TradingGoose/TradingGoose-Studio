import { createWithEqualityFn as create } from 'zustand/traditional'
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

const ENTITY_CONTEXT_KEYS = ['indicatorId', 'mcpServerId', 'customToolId', 'skillId'] as const
const REVIEW_ENTITY_KINDS = ['workflow', 'indicator', 'mcp_server', 'custom_tool', 'skill']

const PAIR_CONTEXT_KEYS = [
  'workflowId',
  'listing',
  'channelId',
  'reviewTarget',
  ...ENTITY_CONTEXT_KEYS,
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

function normalizeContextId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function omitReviewTarget(context: PairColorContext): PairColorContext {
  const { reviewTarget: _removed, ...rest } = context
  return rest
}

function sanitizeReviewTarget(context: PairColorContext): PairColorContext {
  const reviewTargetKind = normalizeContextId(context.reviewTarget?.reviewEntityKind)
  const reviewEntityId = normalizeContextId(context.reviewTarget?.reviewEntityId)
  const reviewDraftSessionId = normalizeContextId(context.reviewTarget?.reviewDraftSessionId)
  const reviewSessionId = normalizeContextId(context.reviewTarget?.reviewSessionId)

  if (!context.reviewTarget) {
    return context
  }

  if (
    !reviewTargetKind ||
    !REVIEW_ENTITY_KINDS.includes(reviewTargetKind) ||
    (!reviewEntityId && !reviewDraftSessionId && !reviewSessionId)
  ) {
    return omitReviewTarget(context)
  }

  return {
    ...context,
    reviewTarget: {
      reviewEntityKind: reviewTargetKind,
      reviewEntityId,
      reviewDraftSessionId,
      reviewSessionId,
    },
  }
}

export function normalizePairColorContext(ctx: PairColorContext): PairColorContext {
  return sanitizeReviewTarget(sanitizePairColorContext(ctx))
}

export const usePairColorStore = create<PairStoreState>((set) => ({
  contexts: emptyContexts,
  setContext: (color, ctx) =>
    set((state) => {
      const nextContext = sanitizePairColorContext(ctx)
      const previous = state.contexts[color]
      const reviewTargetChanged =
        Object.hasOwn(nextContext, 'reviewTarget') &&
        nextContext.reviewTarget !== previous.reviewTarget

      let next: PairColorContext = {
        ...previous,
        ...nextContext,
        updatedAt: Date.now(),
      }

      if (reviewTargetChanged && nextContext.reviewTarget == null) {
        next = omitReviewTarget(next)
      } else if (reviewTargetChanged) {
        next.reviewTarget = nextContext.reviewTarget
      }

      next = sanitizeReviewTarget(next)

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
