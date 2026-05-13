import { createWithEqualityFn as create } from 'zustand/traditional'
import {
  type ListingIdentity,
  type ListingInputValue,
  toListingValueObject,
} from '@/lib/listing/identity'
import { normalizeOptionalString } from '@/lib/utils'
import type { PairColor } from '@/widgets/pair-colors'
import { PAIR_COLORS } from '@/widgets/pair-colors'

export type PairColorContext = {
  workflowId?: string
  listing?: ListingIdentity | null
  indicatorId?: string | null
  mcpServerId?: string | null
  customToolId?: string | null
  skillId?: string | null
}

type PairColorContextSource = PairColorContext | Record<string, unknown> | null | undefined

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

const EDITABLE_ENTITY_KEYS = ['skillId', 'customToolId', 'indicatorId', 'mcpServerId'] as const
type EditableEntityKey = (typeof EDITABLE_ENTITY_KEYS)[number]

function getActiveEditableEntityKey(ctx: PairColorContextSource): EditableEntityKey | null {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) {
    return null
  }

  let activeKey: EditableEntityKey | null = null
  for (const key of EDITABLE_ENTITY_KEYS) {
    if (key in ctx) {
      activeKey = key
    }
  }

  return activeKey
}

function sanitizePairColorContext(ctx: PairColorContextSource): PairColorContext {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) {
    return {}
  }

  const next: PairColorContext = {}
  const workflowId = normalizeOptionalString((ctx as { workflowId?: unknown }).workflowId)
  const listing = toListingValueObject(
    (ctx as { listing?: unknown }).listing as ListingInputValue | null | undefined
  )
  const indicatorId = normalizeOptionalString((ctx as { indicatorId?: unknown }).indicatorId)
  const mcpServerId = normalizeOptionalString((ctx as { mcpServerId?: unknown }).mcpServerId)
  const customToolId = normalizeOptionalString((ctx as { customToolId?: unknown }).customToolId)
  const skillId = normalizeOptionalString((ctx as { skillId?: unknown }).skillId)

  if (workflowId) {
    next.workflowId = workflowId
  }

  if (listing) {
    next.listing = listing
  }

  if (indicatorId) {
    next.indicatorId = indicatorId
  }

  if (mcpServerId) {
    next.mcpServerId = mcpServerId
  }

  if (customToolId) {
    next.customToolId = customToolId
  }

  if (skillId) {
    next.skillId = skillId
  }

  const activeEditableEntityKey = getActiveEditableEntityKey(ctx)
  if (activeEditableEntityKey) {
    for (const key of EDITABLE_ENTITY_KEYS) {
      if (key !== activeEditableEntityKey) {
        delete next[key]
      }
    }
  }

  return next
}

export function normalizePairColorContext(ctx: PairColorContextSource): PairColorContext {
  return sanitizePairColorContext(ctx)
}

export const usePairColorStore = create<PairStoreState>((set) => ({
  contexts: emptyContexts,
  setContext: (color, ctx) =>
    set((state) => {
      const previous = normalizePairColorContext(state.contexts[color] ?? {})
      const next = sanitizePairColorContext({
        ...previous,
        ...ctx,
      })
      for (const key of Object.keys(ctx) as (keyof PairColorContext)[]) {
        if (ctx[key] == null) {
          delete next[key]
        }
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
