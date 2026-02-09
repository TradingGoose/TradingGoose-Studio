import type { DataChartViewParams, IndicatorRef } from '@/widgets/widgets/data_chart/types'

export const buildIndicatorRefs = (
  ids: string[],
  existingRefs: IndicatorRef[] = []
): IndicatorRef[] => {
  const existingMap = new Map(existingRefs.map((ref) => [ref.id, ref]))
  return ids
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => {
      const existing = existingMap.get(id)
      return existing ? { ...existing, id } : { id }
    })
}

export const resolveIndicatorIds = (view?: DataChartViewParams | null): string[] => {
  const refs = Array.isArray(view?.pineIndicators) ? view?.pineIndicators : []
  const ids: string[] = []
  const seen = new Set<string>()
  refs.forEach((ref) => {
    const id = ref && typeof ref.id === 'string' ? ref.id.trim() : ''
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  })
  return ids
}
