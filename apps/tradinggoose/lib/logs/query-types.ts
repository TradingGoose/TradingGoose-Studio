export type QueryValueKind = 'text' | 'id' | 'listing' | 'number' | 'date' | 'token'

export type QueryClauseKind = 'field' | 'has' | 'no'

export type QueryOperator = '=' | '>' | '>=' | '<' | '<=' | 'range'

export type QuerySuggestionSource =
  | 'workflow'
  | 'folder'
  | 'monitorRows'
  | 'staticOptions'
  | 'examplesOnly'

export type SearchClauseKind = 'field' | 'has' | 'no'

export type SearchClauseValueMode = 'text' | 'id' | 'listing' | 'number' | 'date' | 'token'

export interface QueryFieldPolicy {
  key: string
  label: string
  valueKind: QueryValueKind
  clauseKinds: QueryClauseKind[]
  suggestionSource: QuerySuggestionSource
  staticOptions?: Array<{
    value: string
    label: string
    description?: string
  }>
  examples?: string[]
  allowQuotedText?: boolean
  allowIdPrefix?: boolean
  supportsOr?: boolean
  supportsComparison?: boolean
  supportsRange?: boolean
  api: {
    include?: string
    exclude?: string
    hasField?: string
    noField?: string
    range?: {
      lower?: string
      upper?: string
    }
  }
}

export interface QueryPolicy {
  key: 'logs' | 'monitor'
  fields: Record<string, QueryFieldPolicy>
  orderedFields: QueryFieldPolicy[]
}

export interface SearchClause {
  id: string
  kind: SearchClauseKind
  field: string
  negated: boolean
  operator: QueryOperator
  valueMode: SearchClauseValueMode
  values: string[]
  displayValues?: string[]
  raw: string
}

export type QuerySegment =
  | {
      kind: 'text'
      value: string
    }
  | {
      kind: 'clause'
      clause: SearchClause
    }

export interface ParsedQuery {
  clauses: SearchClause[]
  textSearch: string
  segments: QuerySegment[]
  invalidQualifierFragments: string[]
}
