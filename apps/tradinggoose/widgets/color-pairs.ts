import type { PersistedColorPair, PersistedColorPairsState } from '@/widgets/layout'
import { normalizeColorPairsState, normalizePersistedColorPairFields } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'

export {
  createDefaultColorPairsState,
  type LinkedPairColor,
  normalizeColorPairsState,
  normalizeListingIdentity,
  type PersistedColorPair,
  type PersistedColorPairsState,
} from '@/widgets/layout'

export type PairColorContext = Omit<PersistedColorPair, 'color'>

type PairColorContextSource = PairColorContext | Record<string, unknown> | null | undefined

export function normalizePairColorContext(ctx: PairColorContextSource): PairColorContext {
  return normalizePersistedColorPairFields(ctx)
}

export function readPairColorContext(
  state: PersistedColorPairsState | unknown,
  color: PairColor
): PairColorContext {
  if (color === 'gray') return {}
  const pair = normalizeColorPairsState(state).pairs.find((candidate) => candidate.color === color)
  return normalizePairColorContext(pair)
}

export function upsertPairColorContext(
  state: PersistedColorPairsState | unknown,
  color: PairColor,
  patch: PairColorContextSource
): PersistedColorPairsState {
  const normalized = normalizeColorPairsState(state)
  if (color === 'gray') return normalized

  const nextContext = normalizePairColorContext({
    ...readPairColorContext(normalized, color),
    ...(patch ?? {}),
  })
  const pairs = normalized.pairs.filter((pair) => pair.color !== color)

  if (Object.keys(nextContext).length > 0) {
    pairs.push({ color, ...nextContext })
  }

  return { pairs: pairs.sort((left, right) => left.color.localeCompare(right.color)) }
}

export function removePairColorContext(
  state: PersistedColorPairsState | unknown,
  color: PairColor
): PersistedColorPairsState {
  const normalized = normalizeColorPairsState(state)
  if (color === 'gray') return normalized
  return { pairs: normalized.pairs.filter((pair) => pair.color !== color) }
}
