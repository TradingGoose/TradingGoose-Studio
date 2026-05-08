export type SuggestionCategory =
  | 'qualifier'
  | 'value'
  | 'workflow'
  | 'folder'
  | 'monitor'
  | 'provider'
  | 'interval'
  | 'listing'
  | 'status'
  | 'trigger'
  | 'assetType'
  | 'date'
  | 'duration'
  | 'cost'
  | 'has'
  | 'no'
  | 'show-all'

export interface Suggestion {
  id: string
  value: string
  label: string
  description?: string
  color?: string
  category: SuggestionCategory
}

export interface SuggestionSection {
  title: string
  suggestions: Suggestion[]
}

export interface SuggestionGroup {
  type: 'qualifiers' | 'values' | 'multi-section'
  filterKey?: string
  suggestions: Suggestion[]
  sections?: SuggestionSection[]
}
