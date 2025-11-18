import { create } from 'zustand'
import type { PairColor } from '@/widgets/pair-colors'
import { PAIR_COLORS } from '@/widgets/pair-colors'

export type PairColorContext = {
  workflowId?: string
  ticker?: string
  updatedAt?: number
  channelId?: string
}

interface PairStoreState {
  contexts: Record<PairColor, PairColorContext>
  setContext: (color: PairColor, ctx: PairColorContext) => void
  resetContext: (color: PairColor) => void
}

const emptyContexts = PAIR_COLORS.reduce<Record<PairColor, PairColorContext>>((acc, color) => {
  acc[color] = {}
  return acc
}, {} as Record<PairColor, PairColorContext>)

export const usePairColorStore = create<PairStoreState>((set) => ({
  contexts: emptyContexts,
  setContext: (color, ctx) =>
    set((state) => ({
      contexts: {
        ...state.contexts,
        [color]: {
          ...state.contexts[color],
          ...ctx,
          updatedAt: Date.now(),
        },
      },
    })),
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
