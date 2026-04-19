import type {
  IndicatorCatalogItem,
  IndicatorCatalogSection,
  IndicatorCatalogSectionId,
  IndicatorMetadataEntry,
} from '@/lib/copilot/tools/shared/schemas'
import {
  INDICATOR_REFERENCE_ITEM_RECORDS,
  INDICATOR_REFERENCE_QUERY_TERM_ALIASES,
  INDICATOR_REFERENCE_SECTION_RECORDS,
} from '@/lib/indicators/generated/copilot-indicator-reference'

type CatalogFilter = {
  sections?: IndicatorCatalogSectionId[]
  query?: string
  includeItems?: boolean
}

type IndicatorReferenceRecord = IndicatorMetadataEntry & {
  queryText: string
}

const QUERY_TERM_ALIASES = INDICATOR_REFERENCE_QUERY_TERM_ALIASES as Record<
  string,
  readonly string[]
>

const itemRecords = INDICATOR_REFERENCE_ITEM_RECORDS as unknown as IndicatorReferenceRecord[]
const sectionRecords = INDICATOR_REFERENCE_SECTION_RECORDS as unknown as IndicatorReferenceRecord[]

const recordMap = new Map(
  [...sectionRecords, ...itemRecords].map((record) => [record.id, record] as const)
)

const scoreQuery = (queryText: string, normalizedQuery: string, queryTerms: string[]) => {
  if (!normalizedQuery) return 0
  const matchedTerms = queryTerms.filter((term) => queryText.includes(term)).length
  if (matchedTerms === 0) return 0
  return matchedTerms + (queryText.includes(normalizedQuery) ? queryTerms.length : 0)
}

export const listIndicatorCatalog = (
  filters?: CatalogFilter
): {
  sections: IndicatorCatalogSection[]
  items: IndicatorCatalogItem[]
  count: number
  query?: string
} => {
  const sectionFilter = new Set(filters?.sections ?? [])
  const normalizedQuery = filters?.query?.trim().toLowerCase() ?? ''
  const queryTerms = normalizedQuery
    ? Array.from(
        new Set(
          normalizedQuery
            .split(/\s+/)
            .filter(Boolean)
            .flatMap((term) => [term, ...(QUERY_TERM_ALIASES[term] ?? [])])
        )
      )
    : []

  const rankedItems = itemRecords
    .map((item) => {
      if (!item.sectionId) {
        return null
      }
      if (sectionFilter.size > 0 && !sectionFilter.has(item.sectionId)) {
        return null
      }
      const score = normalizedQuery ? scoreQuery(item.queryText, normalizedQuery, queryTerms) : 1
      if (normalizedQuery && score === 0) {
        return null
      }
      return { item, score }
    })
    .filter((entry): entry is { item: IndicatorReferenceRecord; score: number } => entry !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.sectionId!.localeCompare(right.item.sectionId!) ||
        left.item.id.localeCompare(right.item.id)
    )

  const itemIdsBySection = new Map<IndicatorCatalogSectionId, string[]>()
  rankedItems.forEach(({ item }) => {
    const sectionId = item.sectionId as IndicatorCatalogSectionId
    const sectionItems = itemIdsBySection.get(sectionId) ?? []
    sectionItems.push(item.id)
    itemIdsBySection.set(sectionId, sectionItems)
  })

  const sections = sectionRecords
    .filter((section) => {
      const sectionId = section.id as IndicatorCatalogSectionId
      if (sectionFilter.size > 0 && !sectionFilter.has(sectionId)) {
        return false
      }
      if (!normalizedQuery) {
        return true
      }
      return (
        itemIdsBySection.has(sectionId) ||
        scoreQuery(section.queryText, normalizedQuery, queryTerms) > 0
      )
    })
    .map((section) => {
      const sectionId = section.id as IndicatorCatalogSectionId
      return {
        id: sectionId,
        title: section.title,
        summary: section.summary,
        itemCount: itemIdsBySection.get(sectionId)?.length ?? 0,
      }
    })

  const items: IndicatorCatalogItem[] =
    filters?.includeItems === false
      ? []
      : rankedItems.map(({ item }) => ({
          id: item.id,
          sectionId: item.sectionId as IndicatorCatalogSectionId,
          type: item.type as IndicatorCatalogItem['type'],
          title: item.title,
          summary: item.summary,
          support: item.support,
          ...(item.relatedIds?.length ? { relatedIds: item.relatedIds } : {}),
        }))

  return {
    sections,
    items,
    count: items.length,
    ...(normalizedQuery ? { query: filters?.query?.trim() } : {}),
  }
}

export const getIndicatorMetadataByIds = (
  targetIds: string[]
): {
  items: IndicatorMetadataEntry[]
  missingIds: string[]
} => {
  const seen = new Set<string>()
  const items: IndicatorMetadataEntry[] = []
  const missingIds: string[] = []

  targetIds.forEach((targetId) => {
    const normalizedId = targetId.trim()
    if (!normalizedId || seen.has(normalizedId)) {
      return
    }
    seen.add(normalizedId)

    const record = recordMap.get(normalizedId)
    if (!record) {
      missingIds.push(normalizedId)
      return
    }

    const { queryText: _queryText, ...metadata } = record
    items.push(metadata)
  })

  return { items, missingIds }
}
