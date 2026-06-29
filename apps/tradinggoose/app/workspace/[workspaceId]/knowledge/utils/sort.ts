import type { KnowledgeBaseData } from '@/stores/knowledge/store'
import type { SortOrder } from '../components/shared'

/**
 * Sort knowledge bases by the specified field and order
 */
export function sortKnowledgeBases(
  knowledgeBases: KnowledgeBaseData[],
  sortOrder: SortOrder
): KnowledgeBaseData[] {
  return [...knowledgeBases].sort((a, b) => {
    const comparison = a.name.localeCompare(b.name)
    return sortOrder === 'asc' ? comparison : -comparison
  })
}

/**
 * Filter knowledge bases by search query
 */
export function filterKnowledgeBases(
  knowledgeBases: KnowledgeBaseData[],
  searchQuery: string
): KnowledgeBaseData[] {
  if (!searchQuery.trim()) {
    return knowledgeBases
  }

  const query = searchQuery.toLowerCase()
  return knowledgeBases.filter(
    (kb) => kb.name.toLowerCase().includes(query) || kb.description?.toLowerCase().includes(query)
  )
}
