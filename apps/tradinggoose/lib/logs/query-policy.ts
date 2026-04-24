import type { QueryFieldPolicy, QueryPolicy } from '@/lib/logs/query-types'

const makePolicy = (
  key: QueryPolicy['key'],
  fields: QueryFieldPolicy[]
): QueryPolicy => ({
  key,
  fields: Object.fromEntries(fields.map((field) => [field.key, field])),
  orderedFields: fields,
})

const STATUS_OPTIONS = [
  { value: 'error', label: 'Error', description: 'Only failed executions' },
  { value: 'info', label: 'Info', description: 'Only info logs' },
]

const EXECUTION_OUTCOME_OPTIONS = [
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'unknown', label: 'Unknown' },
]

const TRIGGER_OPTIONS = [
  { value: 'api', label: 'API' },
  { value: 'manual', label: 'Manual' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'chat', label: 'Chat' },
  { value: 'schedule', label: 'Schedule' },
]

const ASSET_TYPE_OPTIONS = [
  { value: 'stock', label: 'Stock' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'currency', label: 'Currency' },
  { value: 'default', label: 'Default' },
  { value: 'unknown', label: 'Unknown' },
]

const COMMON_MONITOR_FIELDS: QueryFieldPolicy[] = [
  {
    key: 'workflow',
    label: 'Workflow',
    valueKind: 'text',
    clauseKinds: ['field'],
    suggestionSource: 'workflow',
    allowQuotedText: true,
    allowIdPrefix: true,
    supportsOr: true,
    api: {
      include: 'workflowName',
      exclude: 'excludeWorkflowName',
    },
  },
  {
    key: 'trigger',
    label: 'Trigger',
    valueKind: 'token',
    clauseKinds: ['field'],
    suggestionSource: 'staticOptions',
    staticOptions: TRIGGER_OPTIONS,
    supportsOr: true,
    api: {
      include: 'triggers',
      exclude: 'excludeTriggers',
    },
  },
  {
    key: 'monitor',
    label: 'Monitor',
    valueKind: 'id',
    clauseKinds: ['field', 'has', 'no'],
    suggestionSource: 'monitorRows',
    allowIdPrefix: true,
    supportsOr: true,
    api: {
      include: 'monitorId',
      exclude: 'excludeMonitorId',
      hasField: 'monitor',
      noField: 'monitor',
    },
  },
  {
    key: 'provider',
    label: 'Provider',
    valueKind: 'id',
    clauseKinds: ['field', 'has', 'no'],
    suggestionSource: 'monitorRows',
    allowIdPrefix: true,
    supportsOr: true,
    api: {
      include: 'providerId',
      exclude: 'excludeProviderId',
      hasField: 'provider',
      noField: 'provider',
    },
  },
  {
    key: 'interval',
    label: 'Interval',
    valueKind: 'token',
    clauseKinds: ['field', 'has', 'no'],
    suggestionSource: 'monitorRows',
    supportsOr: true,
    api: {
      include: 'interval',
      exclude: 'excludeInterval',
      hasField: 'interval',
      noField: 'interval',
    },
  },
  {
    key: 'listing',
    label: 'Listing',
    valueKind: 'listing',
    clauseKinds: ['field', 'has', 'no'],
    suggestionSource: 'monitorRows',
    supportsOr: true,
    api: {
      include: 'listings',
      exclude: 'excludeListings',
      hasField: 'listing',
      noField: 'listing',
    },
  },
  {
    key: 'indicator',
    label: 'Indicator',
    valueKind: 'token',
    clauseKinds: ['has', 'no'],
    suggestionSource: 'examplesOnly',
    api: {
      hasField: 'indicator',
      noField: 'indicator',
    },
  },
  {
    key: 'endedAt',
    label: 'Ended at',
    valueKind: 'token',
    clauseKinds: ['has', 'no'],
    suggestionSource: 'examplesOnly',
    api: {
      hasField: 'endedAt',
      noField: 'endedAt',
    },
  },
  {
    key: 'date',
    label: 'Date',
    valueKind: 'date',
    clauseKinds: ['field'],
    suggestionSource: 'examplesOnly',
    supportsComparison: true,
    supportsRange: true,
    examples: ['date:>=2026-01-01', 'date:2026-01-01..2026-01-31', 'date:*..2026-01-31'],
    api: {
      range: {
        lower: 'startedAtFrom',
        upper: 'startedAtTo',
      },
    },
  },
  {
    key: 'duration',
    label: 'Duration',
    valueKind: 'number',
    clauseKinds: ['field'],
    suggestionSource: 'examplesOnly',
    supportsComparison: true,
    supportsRange: true,
    examples: ['duration:>1000', 'duration:1000..5000', 'duration:*..3000'],
    api: {
      range: {
        lower: 'durationMinMs',
        upper: 'durationMaxMs',
      },
    },
  },
  {
    key: 'cost',
    label: 'Cost',
    valueKind: 'number',
    clauseKinds: ['field', 'has', 'no'],
    suggestionSource: 'examplesOnly',
    supportsComparison: true,
    supportsRange: true,
    examples: ['cost:>0', 'cost:0.01..0.25', 'cost:*..0.05'],
    api: {
      range: {
        lower: 'costMin',
        upper: 'costMax',
      },
      hasField: 'cost',
      noField: 'cost',
    },
  },
]

export const LOGS_QUERY_POLICY = makePolicy('logs', [
  {
    key: 'level',
    label: 'Level',
    valueKind: 'token',
    clauseKinds: ['field'],
    suggestionSource: 'staticOptions',
    staticOptions: STATUS_OPTIONS,
    supportsOr: true,
    api: {
      include: 'level',
      exclude: 'excludeLevel',
    },
  },
  {
    key: 'status',
    label: 'Status',
    valueKind: 'token',
    clauseKinds: ['field'],
    suggestionSource: 'staticOptions',
    staticOptions: STATUS_OPTIONS,
    supportsOr: true,
    api: {
      include: 'level',
      exclude: 'excludeLevel',
    },
  },
  ...COMMON_MONITOR_FIELDS,
  {
    key: 'folder',
    label: 'Folder',
    valueKind: 'text',
    clauseKinds: ['field'],
    suggestionSource: 'folder',
    allowQuotedText: true,
    supportsOr: true,
    api: {
      include: 'folderName',
      exclude: 'excludeFolderName',
    },
  },
])

export const MONITOR_QUERY_POLICY = makePolicy('monitor', [
  {
    key: 'status',
    label: 'Status',
    valueKind: 'token',
    clauseKinds: ['field'],
    suggestionSource: 'staticOptions',
    staticOptions: EXECUTION_OUTCOME_OPTIONS,
    supportsOr: true,
    api: {
      include: 'outcomes',
      exclude: 'excludeOutcomes',
    },
  },
  ...COMMON_MONITOR_FIELDS,
  {
    key: 'assetType',
    label: 'Asset Type',
    valueKind: 'token',
    clauseKinds: ['field'],
    suggestionSource: 'staticOptions',
    staticOptions: ASSET_TYPE_OPTIONS,
    supportsOr: true,
    api: {
      include: 'assetTypes',
      exclude: 'excludeAssetTypes',
    },
  },
])
