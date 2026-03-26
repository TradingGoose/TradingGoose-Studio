import { create } from 'zustand'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { PairColor } from '@/widgets/pair-colors'
import { PAIR_COLORS } from '@/widgets/pair-colors'

export type PairColorContext = {
  workflowId?: string
  listing?: ListingIdentity | null
  updatedAt?: number
  channelId?: string
  copilotChatId?: string | null
  indicatorId?: string | null
  pineIndicatorId?: string | null
  mcpServerId?: string | null
  customToolId?: string | null
  skillId?: string | null
}

interface PairStoreState {
  contexts: Record<PairColor, PairColorContext>
  setContext: (color: PairColor, ctx: PairColorContext) => void
  resetContext: (color: PairColor) => void
}

const WORKFLOW_SCOPED_CONTEXT_KEYS = [
  'copilotChatId',
  'indicatorId',
  'pineIndicatorId',
  'mcpServerId',
  'customToolId',
  'skillId',
] as const

const emptyContexts = PAIR_COLORS.reduce<Record<PairColor, PairColorContext>>(
  (acc, color) => {
    acc[color] = {}
    return acc
  },
  {} as Record<PairColor, PairColorContext>
)

export const usePairColorStore = create<PairStoreState>((set) => ({
  contexts: emptyContexts,
  setContext: (color, ctx) =>
    set((state) => {
      const previous = state.contexts[color]
      const workflowChanged =
        typeof ctx.workflowId === 'string' &&
        ctx.workflowId.trim().length > 0 &&
        ctx.workflowId !== previous.workflowId

      let next: PairColorContext = {
        ...previous,
        ...ctx,
        updatedAt: Date.now(),
      }

      if (workflowChanged) {
        for (const key of WORKFLOW_SCOPED_CONTEXT_KEYS) {
          if (typeof ctx[key] !== 'undefined') {
            continue
          }

          const { [key]: _removed, ...rest } = next
          next = rest
        }
      }

      if (ctx.copilotChatId === null) {
        const { copilotChatId: _removed, ...rest } = next
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
