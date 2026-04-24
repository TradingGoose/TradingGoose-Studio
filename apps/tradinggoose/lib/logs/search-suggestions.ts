import type { ListingIdentity } from '@/lib/listing/identity'
import { createSearchClause } from '@/lib/logs/query-parser'
import type { QueryPolicy } from '@/lib/logs/query-types'
import type { Suggestion, SuggestionCategory, SuggestionGroup, SuggestionSection } from '@/app/workspace/[workspaceId]/logs/types'

export interface WorkflowData {
  id: string
  name: string
  description?: string
}

export interface FolderData {
  id: string
  name: string
}

export interface MonitorRowSuggestionData {
  monitorId: string
  monitorLabel: string
  providerId: string
  interval: string
  listing: ListingIdentity | null
  listingLabel: string
}

type SearchSuggestionsOptions = {
  policy: QueryPolicy
  workflowsData?: WorkflowData[]
  foldersData?: FolderData[]
  monitorRows?: MonitorRowSuggestionData[]
}

const normalize = (value: string) => value.trim().toLowerCase()

const matchesPartial = (partial: string, ...values: Array<string | undefined>) => {
  const normalizedPartial = normalize(partial).replace(/^#/, '')
  if (!normalizedPartial) return true

  return values.some((value) => normalize(value ?? '').includes(normalizedPartial))
}

export class SearchSuggestions {
  private policy: QueryPolicy
  private workflowsData: WorkflowData[]
  private foldersData: FolderData[]
  private monitorRows: MonitorRowSuggestionData[]

  constructor(options: SearchSuggestionsOptions) {
    this.policy = options.policy
    this.workflowsData = options.workflowsData ?? []
    this.foldersData = options.foldersData ?? []
    this.monitorRows = options.monitorRows ?? []
  }

  updateData(options: Partial<SearchSuggestionsOptions>) {
    if (options.policy) this.policy = options.policy
    if (options.workflowsData) this.workflowsData = options.workflowsData
    if (options.foldersData) this.foldersData = options.foldersData
    if (options.monitorRows) this.monitorRows = options.monitorRows
  }

  getSuggestions(input: string): SuggestionGroup | null {
    const trimmed = input.trim()
    const negated = trimmed.startsWith('-')
    const normalizedInput = negated ? trimmed.slice(1) : trimmed

    if (!trimmed) {
      return this.getQualifierSuggestions()
    }

    if (normalizedInput === 'has:' || normalizedInput === 'no:') {
      return this.getPresenceFieldSuggestions(
        normalizedInput.startsWith('has:') ? 'has' : 'no'
      )
    }

    if (normalizedInput.startsWith('has:')) {
      return this.getPresenceFieldSuggestions('has', normalizedInput.slice(4))
    }

    if (normalizedInput.startsWith('no:')) {
      return this.getPresenceFieldSuggestions('no', normalizedInput.slice(3))
    }

    if (normalizedInput.endsWith(':')) {
      return this.getFieldValueSuggestions(normalizedInput.slice(0, -1), '', negated)
    }

    const separatorIndex = normalizedInput.indexOf(':')
    if (separatorIndex > 0) {
      return this.getFieldValueSuggestions(
        normalizedInput.slice(0, separatorIndex),
        normalizedInput.slice(separatorIndex + 1),
        negated
      )
    }

    return this.getMultiSectionSuggestions(trimmed)
  }

  private getQualifierSuggestions(): SuggestionGroup {
    const suggestions: Suggestion[] = this.policy.orderedFields
      .filter((field) => field.clauseKinds.includes('field'))
      .map((field) => ({
        id: `qualifier:${field.key}`,
        value: `${field.key}:`,
        label: field.label,
        description: `Filter by ${field.label.toLowerCase()}`,
        category: 'qualifier',
      }))

    const hasFields = this.policy.orderedFields.filter((field) => field.clauseKinds.includes('has'))
    const noFields = this.policy.orderedFields.filter((field) => field.clauseKinds.includes('no'))

    hasFields.forEach((field) => {
      suggestions.push({
        id: `has:${field.key}`,
        value: `has:${field.key}`,
        label: `has:${field.label}`,
        description: `${field.label} has a value`,
        category: 'has',
      })
    })

    noFields.forEach((field) => {
      suggestions.push({
        id: `no:${field.key}`,
        value: `no:${field.key}`,
        label: `no:${field.label}`,
        description: `${field.label} has no value`,
        category: 'no',
      })
    })

    return {
      type: 'qualifiers',
      suggestions,
    }
  }

  private getPresenceFieldSuggestions(kind: 'has' | 'no', partial = ''): SuggestionGroup | null {
    const suggestions = this.policy.orderedFields
      .filter((field) => field.clauseKinds.includes(kind))
      .filter((field) => matchesPartial(partial, field.key, field.label))
      .map((field) => ({
        id: `${kind}:${field.key}`,
        value: `${kind}:${field.key}`,
        label: field.label,
        description: `${field.label} ${kind === 'has' ? 'has' : 'has no'} value`,
        category: kind,
      }))

    if (suggestions.length === 0) {
      return null
    }

    return {
      type: 'values',
      filterKey: kind,
      suggestions,
    }
  }

  private getFieldValueSuggestions(
    fieldKey: string,
    partial: string,
    negated = false
  ): SuggestionGroup | null {
    const field = this.policy.fields[fieldKey]
    if (!field) {
      return null
    }

    const applyNegationPrefix = (value: string) =>
      negated && !value.startsWith('-') ? `-${value}` : value

    let suggestions: Suggestion[] = []

    switch (field.suggestionSource) {
      case 'workflow': {
        suggestions = this.workflowsData
          .filter((workflow) => matchesPartial(partial, workflow.name, workflow.id))
          .slice(0, 10)
          .flatMap((workflow) => {
            const items: Suggestion[] = [
              {
                id: `workflow-name:${workflow.id}`,
                value: applyNegationPrefix(`${field.key}:"${workflow.name}"`),
                label: workflow.name,
                description: workflow.description,
                category: 'workflow',
              },
            ]

            if (field.allowIdPrefix) {
              items.unshift({
                id: `workflow-id:${workflow.id}`,
                value: applyNegationPrefix(`${field.key}:#${workflow.id}`),
                label: workflow.name,
                description: `Exact workflow id ${workflow.id}`,
                category: 'workflow',
              })
            }

            return items
          })
        break
      }
      case 'folder': {
        suggestions = this.foldersData
          .filter((folder) => matchesPartial(partial, folder.name, folder.id))
          .slice(0, 10)
          .map((folder) => ({
            id: `folder:${folder.id}`,
            value: applyNegationPrefix(`${field.key}:"${folder.name}"`),
            label: folder.name,
            category: 'folder',
          }))
        break
      }
      case 'monitorRows': {
        suggestions = this.getMonitorRowSuggestions(fieldKey, partial, negated)
        break
      }
      case 'staticOptions': {
        suggestions = (field.staticOptions ?? [])
          .filter((option) => matchesPartial(partial, option.label, option.value))
          .map((option) => ({
            id: `${field.key}:${option.value}`,
            value: applyNegationPrefix(`${field.key}:${option.value}`),
            label: option.label,
            description: option.description,
            category: field.key as SuggestionCategory,
          }))
        break
      }
      case 'examplesOnly': {
        suggestions = (field.examples ?? [])
          .filter((example) => matchesPartial(partial, example))
          .map((example) => ({
            id: `${field.key}:${example}`,
            value: applyNegationPrefix(
              example.startsWith(`${field.key}:`) ? example : `${field.key}:${example}`
            ),
            label: example,
            category: field.key as SuggestionCategory,
          }))
        break
      }
    }

    if (suggestions.length === 0) {
      return null
    }

    return {
      type: 'values',
      filterKey: fieldKey,
      suggestions,
    }
  }

  private getMonitorRowSuggestions(
    fieldKey: string,
    partial: string,
    negated: boolean
  ): Suggestion[] {
    const applyNegationPrefix = (value: string) =>
      negated && !value.startsWith('-') ? `-${value}` : value

    if (fieldKey === 'monitor') {
      return this.monitorRows
        .filter((row) => matchesPartial(partial, row.monitorLabel, row.monitorId))
        .slice(0, 10)
        .map((row) => ({
          id: `monitor:${row.monitorId}`,
          value: applyNegationPrefix(`monitor:#${row.monitorId}`),
          label: row.monitorLabel,
          description: row.monitorId,
          category: 'monitor',
        }))
    }

    if (fieldKey === 'provider') {
      const providers = new Map<string, Suggestion>()
      this.monitorRows.forEach((row) => {
        if (!row.providerId || !matchesPartial(partial, row.providerId)) return
        providers.set(row.providerId, {
          id: `provider:${row.providerId}`,
          value: applyNegationPrefix(`provider:#${row.providerId}`),
          label: row.providerId,
          category: 'provider',
        })
      })
      return Array.from(providers.values())
    }

    if (fieldKey === 'interval') {
      const intervals = new Map<string, Suggestion>()
      this.monitorRows.forEach((row) => {
        if (!row.interval || !matchesPartial(partial, row.interval)) return
        intervals.set(row.interval, {
          id: `interval:${row.interval}`,
          value: applyNegationPrefix(`interval:${row.interval}`),
          label: row.interval,
          category: 'interval',
        })
      })
      return Array.from(intervals.values())
    }

    if (fieldKey === 'listing') {
      const listings = new Map<string, Suggestion>()
      this.monitorRows.forEach((row) => {
        if (!row.listing || !matchesPartial(partial, row.listingLabel)) return
        const encoded = JSON.stringify(row.listing)
        const clause = createSearchClause(
          {
            kind: 'field',
            field: 'listing',
            negated,
            operator: '=',
            valueMode: 'listing',
            values: [encoded],
          },
          this.policy
        )
        listings.set(encoded, {
          id: `listing:${encoded}`,
          value: clause.raw,
          label: row.listingLabel,
          category: 'listing',
        })
      })
      return Array.from(listings.values())
    }

    return []
  }

  private getMultiSectionSuggestions(input: string): SuggestionGroup {
    const sections: SuggestionSection[] = []

    const qualifierSuggestions = this.policy.orderedFields
      .filter((field) => field.clauseKinds.includes('field'))
      .filter((field) => matchesPartial(input, field.key, field.label))
      .map((field) => ({
        id: `qualifier:${field.key}`,
        value: `${field.key}:`,
        label: field.label,
        description: `Filter by ${field.label.toLowerCase()}`,
        category: 'qualifier' as const,
      }))

    if (qualifierSuggestions.length > 0) {
      sections.push({
        title: 'Qualifiers',
        suggestions: qualifierSuggestions,
      })
    }

    const workflowSuggestions = this.workflowsData
      .filter((workflow) => matchesPartial(input, workflow.name, workflow.id))
      .slice(0, 5)
      .map((workflow) => ({
        id: `workflow-id:${workflow.id}`,
        value: `workflow:#${workflow.id}`,
        label: workflow.name,
        description: workflow.description,
        category: 'workflow' as const,
      }))

    if (workflowSuggestions.length > 0) {
      sections.push({
        title: 'Workflows',
        suggestions: workflowSuggestions,
      })
    }

    if (this.policy.fields.folder) {
      const folderSuggestions = this.foldersData
        .filter((folder) => matchesPartial(input, folder.name))
        .slice(0, 5)
        .map((folder) => ({
          id: `folder:${folder.id}`,
          value: `folder:"${folder.name}"`,
          label: folder.name,
          category: 'folder' as const,
        }))

      if (folderSuggestions.length > 0) {
        sections.push({
          title: 'Folders',
          suggestions: folderSuggestions,
        })
      }
    }

    const suggestions = sections.flatMap((section) => section.suggestions)

    suggestions.push({
      id: `show-all:${input}`,
      value: input,
      label: `Search for "${input}"`,
      category: 'show-all',
    })

    return {
      type: 'multi-section',
      suggestions,
      sections,
    }
  }
}
