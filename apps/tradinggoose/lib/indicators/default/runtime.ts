import { normalizeInputMetaMap } from '@/lib/indicators/input-meta'
import type { InputMetaMap } from '@/lib/indicators/types'
import { DEFAULT_INDICATORS } from './index'

export type DefaultIndicatorRuntimeEntry = {
  id: string
  name: string
  pineCode: string
  inputMeta?: InputMetaMap
}

export const DEFAULT_INDICATOR_RUNTIME_ENTRIES: DefaultIndicatorRuntimeEntry[] =
  DEFAULT_INDICATORS.map((indicator) => ({
    id: indicator.id,
    name: indicator.name,
    pineCode: indicator.pineCode,
    inputMeta: normalizeInputMetaMap(indicator.inputMeta),
  }))

export const DEFAULT_INDICATOR_RUNTIME_IDS = DEFAULT_INDICATOR_RUNTIME_ENTRIES.map(
  (entry) => entry.id
)

export const DEFAULT_INDICATOR_RUNTIME_MAP = new Map(
  DEFAULT_INDICATOR_RUNTIME_ENTRIES.map((entry) => [entry.id, entry] as const)
)

export const DEFAULT_INDICATOR_RUNTIME_MANIFEST = {
  indicators: DEFAULT_INDICATOR_RUNTIME_ENTRIES,
}

export const resolveDefaultIndicatorRuntimeEntry = (
  alias: string
): DefaultIndicatorRuntimeEntry | null => {
  const normalizedAlias = alias.trim()
  if (!normalizedAlias) return null
  return DEFAULT_INDICATOR_RUNTIME_MAP.get(normalizedAlias) ?? null
}
