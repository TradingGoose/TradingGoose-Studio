import { normalizeManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/snapshot'
import type { DrawToolsRef } from '@/widgets/widgets/data_chart/types'

export const DEFAULT_MANUAL_DRAW_TOOLS: DrawToolsRef[] = [{ id: 'manual-main', pane: 'price' }]

export const makeUniqueDrawToolsId = (baseId: string, drawTools: DrawToolsRef[]): string => {
  const existing = new Set(drawTools.map((entry) => entry.id))
  if (!existing.has(baseId)) {
    return baseId
  }

  let suffix = 2
  let nextId = `${baseId}-${suffix}`
  while (existing.has(nextId)) {
    suffix += 1
    nextId = `${baseId}-${suffix}`
  }
  return nextId
}

export const normalizeDrawToolsRefs = (raw: unknown): DrawToolsRef[] => {
  if (!Array.isArray(raw)) return []
  const counts = new Map<string, number>()

  return raw.reduce<DrawToolsRef[]>((acc, entry, index) => {
    const record = entry as Partial<DrawToolsRef> | null
    const candidateId = typeof record?.id === 'string' ? record.id.trim() : ''
    const baseId = candidateId || `manual-${index + 1}`
    const seen = counts.get(baseId) ?? 0
    const normalizedId = seen === 0 ? baseId : `${baseId}-${seen + 1}`
    counts.set(baseId, seen + 1)

    const snapshot = normalizeManualOwnerSnapshot(record?.snapshot)
    const rawPane = record?.pane === 'indicator' ? 'indicator' : 'price'
    const indicatorId = typeof record?.indicatorId === 'string' ? record.indicatorId.trim() : ''
    const pane = rawPane === 'indicator' && indicatorId ? 'indicator' : 'price'

    const normalized: DrawToolsRef =
      pane === 'indicator'
        ? {
            id: normalizedId,
            pane: 'indicator',
            indicatorId,
          }
        : {
            id: normalizedId,
            pane: 'price',
          }
    if (snapshot) {
      normalized.snapshot = snapshot
    }
    acc.push(normalized)
    return acc
  }, [])
}
