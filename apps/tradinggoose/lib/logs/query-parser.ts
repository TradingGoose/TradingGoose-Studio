import { toListingValueObject } from '@/lib/listing/identity'
import type {
  ParsedQuery,
  QueryFieldPolicy,
  QueryOperator,
  QueryPolicy,
  SearchClause,
} from '@/lib/logs/query-types'

const QUALIFIER_PATTERN = /^-?[a-zA-Z][\w-]*:/

const tokenizeQuery = (query: string): string[] => {
  const tokens: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index]

    if (character === '"' && query[index - 1] !== '\\') {
      inQuotes = !inQuotes
      current += character
      continue
    }

    if (!inQuotes && /\s/.test(character)) {
      if (current.trim().length > 0) {
        tokens.push(current.trim())
      }
      current = ''
      continue
    }

    current += character
  }

  if (current.trim().length > 0) {
    tokens.push(current.trim())
  }

  return tokens
}

const unquote = (value: string) => {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }

  return value
}

const quoteIfNeeded = (value: string) => {
  if (value.length === 0) {
    return '""'
  }

  if (/[\s,"]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`
  }

  return value
}

const splitOrValues = (value: string) => {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]

    if (character === '"' && value[index - 1] !== '\\') {
      inQuotes = !inQuotes
      current += character
      continue
    }

    if (character === ',' && !inQuotes) {
      if (current.trim().length > 0) {
        values.push(current.trim())
      }
      current = ''
      continue
    }

    current += character
  }

  if (current.trim().length > 0) {
    values.push(current.trim())
  }

  return values
}

const uniqueValues = (values: string[]) => {
  const unique = new Set<string>()

  values.forEach((value) => {
    const trimmed = value.trim()
    if (!trimmed) return
    unique.add(trimmed)
  })

  return Array.from(unique)
}

const sortValues = (values: string[]) =>
  [...values].sort((left, right) =>
    left.localeCompare(right, 'en-US', {
      numeric: true,
      sensitivity: 'base',
    })
  )

const parseFieldValue = (
  policy: QueryFieldPolicy,
  rawValue: string
): { operator: QueryOperator; valueMode: SearchClause['valueMode']; values: string[] } | null => {
  if (!rawValue) return null

  let operator: QueryOperator = '='
  let valuePayload = rawValue

  if (policy.supportsRange && rawValue.includes('..')) {
    operator = 'range'
    const [left, right] = rawValue.split('..', 2)
    const lower = left?.trim() === '*' ? '' : unquote(left?.trim() ?? '')
    const upper = right?.trim() === '*' ? '' : unquote(right?.trim() ?? '')
    return {
      operator,
      valueMode: policy.valueKind,
      values: [lower, upper],
    }
  }

  if (policy.supportsComparison) {
    if (rawValue.startsWith('>=')) {
      operator = '>='
      valuePayload = rawValue.slice(2)
    } else if (rawValue.startsWith('<=')) {
      operator = '<='
      valuePayload = rawValue.slice(2)
    } else if (rawValue.startsWith('>')) {
      operator = '>'
      valuePayload = rawValue.slice(1)
    } else if (rawValue.startsWith('<')) {
      operator = '<'
      valuePayload = rawValue.slice(1)
    } else if (rawValue.startsWith('=')) {
      operator = '='
      valuePayload = rawValue.slice(1)
    }
  }

  let valueMode: SearchClause['valueMode'] = policy.valueKind
  let values = policy.supportsOr ? splitOrValues(valuePayload) : [valuePayload]

  const normalizedValues = values.map((value) => {
    const trimmed = value.trim()

    if (policy.allowIdPrefix && trimmed.startsWith('#')) {
      return {
        valueMode: 'id' as const,
        value: trimmed.slice(1).trim(),
      }
    }

    if (policy.valueKind === 'listing') {
      try {
        const normalized = toListingValueObject(JSON.parse(unquote(trimmed)))
        if (normalized) {
          return {
            valueMode: 'listing' as const,
            value: JSON.stringify(normalized),
          }
        }
      } catch {
        return {
          valueMode: 'listing' as const,
          value: trimmed,
        }
      }
    }

    return {
      valueMode: policy.valueKind,
      value: unquote(trimmed),
    }
  })

  const valueModes = Array.from(new Set(normalizedValues.map((entry) => entry.valueMode)))
  if (valueModes.length > 1) {
    return null
  }

  valueMode = valueModes[0] ?? policy.valueKind
  values = uniqueValues(normalizedValues.map((entry) => entry.value))

  if (values.length === 0) {
    return null
  }

  return {
    operator,
    valueMode,
    values,
  }
}

export const serializeSearchClause = (clause: SearchClause, policy: QueryPolicy) => {
  const fieldPolicy = policy.fields[clause.field]
  if (!fieldPolicy) {
    return clause.raw
  }

  if (clause.kind === 'has') {
    return `has:${clause.field}`
  }

  if (clause.kind === 'no') {
    return `no:${clause.field}`
  }

  const prefix = clause.negated ? '-' : ''

  const serializeValue = (value: string) => {
    if (clause.valueMode === 'id') {
      return `#${value}`
    }

    if (clause.valueMode === 'listing') {
      return quoteIfNeeded(value)
    }

    if (clause.valueMode === 'text') {
      return quoteIfNeeded(value)
    }

    return value
  }

  if (clause.operator === 'range') {
    const lower = clause.values[0]?.trim() ? serializeValue(clause.values[0]!) : '*'
    const upper = clause.values[1]?.trim() ? serializeValue(clause.values[1]!) : '*'
    return `${prefix}${clause.field}:${lower}..${upper}`
  }

  const operatorPrefix = clause.operator === '=' ? '' : clause.operator
  const joinedValues = clause.values.map(serializeValue).join(',')

  return `${prefix}${clause.field}:${operatorPrefix}${joinedValues}`
}

export const createSearchClause = (
  input: Omit<SearchClause, 'id' | 'raw'>,
  policy: QueryPolicy
): SearchClause => {
  const clause = {
    ...input,
    displayValues: input.displayValues?.length ? input.displayValues : undefined,
    values:
      input.operator === 'range'
        ? [(input.values[0] ?? '').trim(), (input.values[1] ?? '').trim()]
        : sortValues(uniqueValues(input.values)),
  } satisfies Omit<SearchClause, 'id' | 'raw'>
  const raw = serializeSearchClause(clause as SearchClause, policy)

  return {
    ...clause,
    id: raw,
    raw,
  }
}

export function parseQuery(query: string, policy: QueryPolicy): ParsedQuery {
  const tokens = tokenizeQuery(query)
  const clauses: SearchClause[] = []
  const segments: ParsedQuery['segments'] = []
  const textTokens: string[] = []
  const invalidQualifierFragments: string[] = []

  tokens.forEach((token) => {
    if (token.startsWith('has:')) {
      const field = token.slice(4).trim()
      const fieldPolicy = policy.fields[field]

      if (fieldPolicy?.clauseKinds.includes('has')) {
        const clause = createSearchClause(
          {
            kind: 'has',
            field,
            negated: false,
            operator: '=',
            valueMode: fieldPolicy.valueKind,
            values: [],
          },
          policy
        )
        clauses.push(clause)
        segments.push({ kind: 'clause', clause })
      } else if (field) {
        invalidQualifierFragments.push(token)
      }
      return
    }

    if (token.startsWith('no:')) {
      const field = token.slice(3).trim()
      const fieldPolicy = policy.fields[field]

      if (fieldPolicy?.clauseKinds.includes('no')) {
        const clause = createSearchClause(
          {
            kind: 'no',
            field,
            negated: false,
            operator: '=',
            valueMode: fieldPolicy.valueKind,
            values: [],
          },
          policy
        )
        clauses.push(clause)
        segments.push({ kind: 'clause', clause })
      } else if (field) {
        invalidQualifierFragments.push(token)
      }
      return
    }

    const negated = token.startsWith('-')
    const workingToken = negated ? token.slice(1) : token

    if (QUALIFIER_PATTERN.test(workingToken)) {
      const separatorIndex = workingToken.indexOf(':')
      const field = workingToken.slice(0, separatorIndex).trim()
      const rawValue = workingToken.slice(separatorIndex + 1).trim()
      const fieldPolicy = policy.fields[field]

      if (!fieldPolicy || !fieldPolicy.clauseKinds.includes('field')) {
        invalidQualifierFragments.push(token)
        return
      }

      const parsedValue = parseFieldValue(fieldPolicy, rawValue)
      if (!parsedValue) {
        invalidQualifierFragments.push(token)
        return
      }

      if (negated && (fieldPolicy.supportsComparison || fieldPolicy.supportsRange)) {
        invalidQualifierFragments.push(token)
        return
      }

      const clause = createSearchClause(
        {
          kind: 'field',
          field,
          negated,
          operator: parsedValue.operator,
          valueMode: parsedValue.valueMode,
          values: parsedValue.values,
        },
        policy
      )
      clauses.push(clause)
      segments.push({ kind: 'clause', clause })
      return
    }

    if (token.includes(':') && QUALIFIER_PATTERN.test(token)) {
      invalidQualifierFragments.push(token)
      return
    }

    const textValue = unquote(token)
    textTokens.push(textValue)
    segments.push({ kind: 'text', value: textValue })
  })

  const textSearch = textTokens.join(' ').trim()

  return {
    clauses,
    textSearch,
    segments,
    invalidQualifierFragments,
  }
}

export const serializeQuery = (
  input:
    | ParsedQuery
    | {
        clauses: SearchClause[]
        textSearch: string
      },
  policy: QueryPolicy
) => {
  if ('segments' in input && Array.isArray(input.segments) && input.segments.length > 0) {
    return input.segments
      .map((segment) =>
        segment.kind === 'clause'
          ? serializeSearchClause(segment.clause, policy)
          : quoteIfNeeded(segment.value)
      )
      .join(' ')
      .trim()
  }

  const clauseStrings = input.clauses.map((clause) => serializeSearchClause(clause, policy))
  const textSearch = input.textSearch.trim()

  return [...clauseStrings, ...(textSearch ? [textSearch] : [])].join(' ').trim()
}

const pushMultiValue = (map: Map<string, Set<string>>, key: string | undefined, values: string[]) => {
  if (!key || values.length === 0) return
  const existing = map.get(key) ?? new Set<string>()
  values.forEach((value) => {
    const trimmed = value.trim()
    if (trimmed) {
      existing.add(trimmed)
    }
  })
  map.set(key, existing)
}

const applyRangeParams = (
  params: Record<string, string>,
  clause: SearchClause,
  policy: QueryFieldPolicy
) => {
  if (clause.negated) {
    return
  }

  const lowerKey = policy.api.range?.lower
  const upperKey = policy.api.range?.upper

  if (clause.operator === 'range') {
    const [lower, upper] = clause.values
    if (lowerKey && lower?.trim()) {
      params[lowerKey] = lower.trim()
    }
    if (upperKey && upper?.trim()) {
      params[upperKey] = upper.trim()
    }
    return
  }

  const value = clause.values[0]?.trim()
  if (!value) return

  if ((clause.operator === '>' || clause.operator === '>=') && lowerKey) {
    params[lowerKey] = value
    if (clause.operator === '>') {
      params[`${lowerKey}Exclusive`] = 'true'
    }
  }

  if ((clause.operator === '<' || clause.operator === '<=') && upperKey) {
    params[upperKey] = value
    if (clause.operator === '<') {
      params[`${upperKey}Exclusive`] = 'true'
    }
  }

  if (clause.operator === '=' && lowerKey && upperKey) {
    params[lowerKey] = value
    params[upperKey] = value
  }
}

export function queryToApiParams(parsedQuery: ParsedQuery, policy: QueryPolicy): Record<string, string> {
  const params: Record<string, string> = {}
  const multiValueParams = new Map<string, Set<string>>()
  const listingValues = new Set<string>()
  const excludedListingValues = new Set<string>()
  const hasFields = new Set<string>()
  const noFields = new Set<string>()

  if (parsedQuery.textSearch) {
    params.search = parsedQuery.textSearch
  }

  parsedQuery.clauses.forEach((clause) => {
    const fieldPolicy = policy.fields[clause.field]
    if (!fieldPolicy) return

    if (clause.kind === 'has') {
      if (fieldPolicy.api.hasField) {
        hasFields.add(fieldPolicy.api.hasField)
      }
      return
    }

    if (clause.kind === 'no') {
      if (fieldPolicy.api.noField) {
        noFields.add(fieldPolicy.api.noField)
      }
      return
    }

    if (fieldPolicy.supportsComparison || fieldPolicy.supportsRange) {
      applyRangeParams(params, clause, fieldPolicy)
      return
    }

    if (clause.field === 'workflow' && clause.valueMode === 'id') {
      pushMultiValue(
        multiValueParams,
        clause.negated ? 'excludeWorkflowIds' : 'workflowIds',
        clause.values
      )
      return
    }

    if (clause.field === 'listing') {
      clause.values.forEach((value) => {
        try {
          const normalized = toListingValueObject(JSON.parse(value))
          if (!normalized) return
          const encoded = JSON.stringify(normalized)
          if (clause.negated) {
            excludedListingValues.add(encoded)
          } else {
            listingValues.add(encoded)
          }
        } catch {
          // ignore invalid listing payloads
        }
      })
      return
    }

    pushMultiValue(
      multiValueParams,
      clause.negated ? fieldPolicy.api.exclude : fieldPolicy.api.include,
      clause.values
    )
  })

  multiValueParams.forEach((values, key) => {
    if (values.size > 0) {
      params[key] = Array.from(values).join(',')
    }
  })

  if (listingValues.size > 0) {
    params.listings = JSON.stringify(Array.from(listingValues).map((value) => JSON.parse(value)))
  }

  if (excludedListingValues.size > 0) {
    params.excludeListings = JSON.stringify(
      Array.from(excludedListingValues).map((value) => JSON.parse(value))
    )
  }

  if (hasFields.size > 0) {
    params.hasFields = Array.from(hasFields).join(',')
  }

  if (noFields.size > 0) {
    params.noFields = Array.from(noFields).join(',')
  }

  return params
}
