import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import {
  normalizeListingIdentity,
  normalizePairColorContext,
  type PairColorContext,
} from '@/widgets/color-pairs'
import type { WidgetInstance } from '@/widgets/layout'

export { normalizeListingIdentity } from '@/widgets/color-pairs'

export type WidgetCategory = 'editor' | 'list' | 'utility' | 'trading'

export const WIDGET_KEYS = [
  'data_chart',
  'list_workflow',
  'editor_workflow',
  'workflow_chat',
  'workflow_console',
  'copilot',
  'list_indicator',
  'list_mcp',
  'editor_indicator',
  'editor_mcp',
  'list_custom_tool',
  'editor_custom_tool',
  'list_skill',
  'editor_skill',
  'workflow_variables',
  'watchlist',
  'portfolio_snapshot',
  'quick_order',
  'heatmap',
] as const

export type WidgetKey = (typeof WIDGET_KEYS)[number]

export type WidgetReferenceParamField =
  | 'workflowId'
  | 'watchlistId'
  | 'listing'
  | 'indicatorId'
  | 'mcpServerId'
  | 'customToolId'
  | 'skillId'

type WidgetParamFieldKind = 'entity-reference' | 'listing' | 'string' | 'enum' | 'record' | 'json'

export type WidgetParamFieldContract = {
  field: string
  kind: WidgetParamFieldKind
  referenceKind?: string
  allowedValues?: string[]
}

type WidgetParamContractDef = Omit<WidgetParamFieldContract, 'field'>

const FIELD_DEFS = {
  workflowId: {
    kind: 'entity-reference',
    referenceKind: 'workflow',
  },
  watchlistId: {
    kind: 'entity-reference',
    referenceKind: 'watchlist',
  },
  listing: {
    kind: 'listing',
  },
  indicatorId: {
    kind: 'entity-reference',
    referenceKind: 'indicator',
  },
  mcpServerId: {
    kind: 'entity-reference',
    referenceKind: 'mcp_server',
  },
  customToolId: {
    kind: 'entity-reference',
    referenceKind: 'custom_tool',
  },
  skillId: {
    kind: 'entity-reference',
    referenceKind: 'skill',
  },
  provider: {
    kind: 'string',
  },
  providerParams: {
    kind: 'record',
  },
  auth: {
    kind: 'record',
  },
  data: {
    kind: 'record',
  },
  view: {
    kind: 'record',
  },
  runtime: {
    kind: 'record',
  },
  sourceMode: {
    kind: 'enum',
    allowedValues: ['watchlist', 'portfolio'],
  },
  watchlistSizeMetric: {
    kind: 'enum',
    allowedValues: ['volume', 'volumeUsd'],
  },
  marketProvider: { kind: 'string' },
  marketProviderParams: {
    kind: 'record',
  },
  marketAuth: {
    kind: 'record',
  },
  tradingProvider: { kind: 'string' },
  serviceId: { kind: 'string' },
  portfolioIdentity: {
    kind: 'json',
  },
  selectedWindow: {
    kind: 'string',
  },
  side: {
    kind: 'enum',
    allowedValues: ['buy', 'sell'],
  },
} satisfies Record<string, WidgetParamContractDef>

export type WidgetParamField = keyof typeof FIELD_DEFS

export const FIELD_CONTRACTS = Object.fromEntries(
  Object.entries(FIELD_DEFS).map(([field, def]) => [field, { field, ...def }])
) as Record<WidgetParamField, WidgetParamFieldContract>

export type WidgetParamsNormalizationOptions = { strictUnknown?: boolean }

export type WidgetValidationIssue = { path: string; message: string }

export class WidgetContractValidationError extends Error {
  public readonly issues: WidgetValidationIssue[]

  constructor(issues: WidgetValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    this.name = 'WidgetContractValidationError'
    this.issues = issues
  }
}

export function isWidgetContractValidationError(
  error: unknown
): error is WidgetContractValidationError {
  return error instanceof WidgetContractValidationError
}

export function failWidgetContractField(path: string, message: string): never {
  throw new WidgetContractValidationError([{ path, message }])
}

export type WidgetCatalogItem = {
  widgetKey: WidgetKey
  title: string
  category: WidgetCategory
  description: string
  editable: boolean
  editableFields: WidgetParamField[]
  linkedParamFields: WidgetParamField[]
}

export type WidgetMetadataProfile = {
  widgetKey: WidgetKey
  title: string
  category: WidgetCategory
  description: string
  editable: boolean
  defaultParams: Record<string, unknown> | null
  editableFields: WidgetParamField[]
  paramContract: WidgetParamFieldContract[]
  linkedParamFields: WidgetParamField[]
}

export type WidgetContract = {
  key: WidgetKey
  title: string
  category: WidgetCategory
  description: string
  editable: boolean
  defaultParams: Record<string, unknown> | null
  editableFields: WidgetParamField[]
  linkedParamFields: WidgetParamField[]
  createDefaultInstance: () => NonNullable<WidgetInstance>
  sanitizeLocalParams: (
    params: unknown,
    options?: WidgetParamsNormalizationOptions
  ) => Record<string, unknown> | null
  mergeLocalParams: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>
  ) => Record<string, unknown> | null
  projectCopilotParams: (
    params: Record<string, unknown> | null | undefined
  ) => Record<string, unknown> | null
  mergeCopilotParams: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown> | null
  ) => Record<string, unknown> | null
  projectCopilotParamsReviewBase: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>
  ) => Record<string, unknown>
  resolveEffectiveParams: (
    widget: WidgetInstance,
    pairContext: PairColorContext
  ) => Record<string, unknown> | null
}

type ContractInput = Omit<
  WidgetContract,
  | 'createDefaultInstance'
  | 'sanitizeLocalParams'
  | 'mergeLocalParams'
  | 'projectCopilotParams'
  | 'mergeCopilotParams'
  | 'projectCopilotParamsReviewBase'
  | 'resolveEffectiveParams'
> & {
  sanitizeLocalParams?: (
    params: unknown,
    options?: WidgetParamsNormalizationOptions
  ) => Record<string, unknown> | null
  mergeLocalParams?: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>
  ) => Record<string, unknown> | null
  projectCopilotParams?: WidgetContract['projectCopilotParams']
  mergeCopilotParams?: WidgetContract['mergeCopilotParams']
  projectCopilotParamsReviewBase?: WidgetContract['projectCopilotParamsReviewBase']
}

export function defineWidgetContract(input: ContractInput): WidgetContract {
  const sanitize =
    input.sanitizeLocalParams ??
    ((params: unknown, options?: WidgetParamsNormalizationOptions) =>
      sanitizeLocalParamsByFields(input.key, input.editableFields, params, options))
  const merge =
    input.mergeLocalParams ??
    ((
      currentParams: Record<string, unknown> | null | undefined,
      incomingParams: Record<string, unknown>
    ) =>
      sanitize(
        {
          ...(sanitize(currentParams, { strictUnknown: false }) ?? {}),
          ...incomingParams,
        },
        { strictUnknown: true }
      ))
  return {
    ...input,
    createDefaultInstance: () => ({
      key: input.key,
      pairColor: 'gray',
      params: cloneWidgetParams(input.defaultParams),
    }),
    sanitizeLocalParams: sanitize,
    mergeLocalParams: merge,
    projectCopilotParams: input.projectCopilotParams ?? ((params) => params ?? null),
    mergeCopilotParams:
      input.mergeCopilotParams ??
      ((currentParams, incomingParams) =>
        incomingParams === null ? null : merge(currentParams, incomingParams)),
    projectCopilotParamsReviewBase:
      input.projectCopilotParamsReviewBase ?? projectCopilotParamsReviewBase,
    resolveEffectiveParams(widget, pairContext) {
      const localParams = sanitize(widget?.params, { strictUnknown: false }) ?? {}
      const normalizedPairContext = normalizePairColorContext(pairContext)

      for (const field of input.linkedParamFields) {
        const value = normalizedPairContext[field as keyof PairColorContext]
        if (value != null) {
          localParams[field] = value
        } else {
          delete localParams[field]
        }
      }

      return Object.keys(localParams).length > 0 ? localParams : null
    },
  }
}

export function projectCopilotParamsReviewBase(
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>,
  nestedFields: readonly string[] = []
): Record<string, unknown> {
  const current = currentParams ?? {}
  const nested = new Set(nestedFields)
  const reviewBase = Object.fromEntries(
    Object.entries(incomingParams).map(([field, incomingValue]) => {
      const currentValue = Object.hasOwn(current, field) ? current[field] : null
      if (nested.has(field) && isRecord(incomingValue)) {
        return [
          field,
          projectCopilotParamsReviewBase(
            isRecord(currentValue) ? currentValue : null,
            incomingValue
          ),
        ]
      }
      return [field, currentValue]
    })
  )

  for (const [selector, dependent] of [
    ['provider', 'providerParams'],
    ['marketProvider', 'marketProviderParams'],
  ] as const) {
    if (Object.hasOwn(incomingParams, selector) && !Object.hasOwn(reviewBase, dependent)) {
      reviewBase[dependent] = Object.hasOwn(current, dependent) ? current[dependent] : null
    }
  }

  return reviewBase
}

export function defineEntityWidgetContract(
  key: WidgetKey,
  title: string,
  category: WidgetCategory,
  description: string,
  field: WidgetReferenceParamField
): WidgetContract {
  return defineWidgetContract({
    key,
    title,
    category,
    description,
    editable: true,
    editableFields: [field],
    linkedParamFields: [field],
    defaultParams: null,
  })
}

export function sanitizeLocalParamsByFields(
  widgetKey: WidgetKey,
  fields: readonly WidgetParamField[],
  params: unknown,
  options: WidgetParamsNormalizationOptions = {}
): Record<string, unknown> | null {
  if (fields.length === 0) {
    if (
      options.strictUnknown &&
      params &&
      typeof params === 'object' &&
      Object.keys(params).length > 0
    ) {
      failWidgetContractField('params', `Widget "${widgetKey}" does not accept params`)
    }
    return null
  }

  if (params == null) return null
  if (!isRecord(params)) {
    failWidgetContractField('params', `Widget "${widgetKey}" params must be an object or null`)
  }

  assertKnownWidgetParamFields(widgetKey, fields, params, options)

  const normalized: Record<string, unknown> = {}
  for (const field of fields) {
    if (!(field in params)) continue
    const value = normalizeFieldValue(FIELD_CONTRACTS[field], params[field], params, options)
    if (value !== undefined) {
      normalized[field] = value
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

export function mergeParamsWithRuntime(
  sanitize: (
    params: unknown,
    options?: WidgetParamsNormalizationOptions
  ) => Record<string, unknown> | null,
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
): Record<string, unknown> | null {
  const merged = { ...(currentParams ?? {}), ...incomingParams }
  if (isRecord(incomingParams.runtime)) {
    merged.runtime = {
      ...(isRecord(currentParams?.runtime) ? currentParams.runtime : {}),
      ...incomingParams.runtime,
    }
  }
  return sanitize(merged, { strictUnknown: true })
}

export function assertKnownWidgetParamFields(
  widgetKey: WidgetKey,
  fields: readonly WidgetParamField[],
  params: Record<string, unknown>,
  options: WidgetParamsNormalizationOptions = {}
) {
  if (!options.strictUnknown) return
  const allowed = new Set<WidgetParamField>(fields)
  const unknownFields = Object.keys(params).filter(
    (field) => !allowed.has(field as WidgetParamField)
  )
  if (unknownFields.length > 0) {
    throw new WidgetContractValidationError(
      unknownFields.map((field) => ({
        path: `params.${field}`,
        message: `Widget "${widgetKey}" does not support this field`,
      }))
    )
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue).filter((item) => item !== undefined)
  }
  if (isRecord(value)) {
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      const normalized = sanitizeJsonValue(entry)
      if (normalized !== undefined) acc[key] = normalized
      return acc
    }, {})
  }
  return undefined
}

function normalizeFieldValue(
  contract: WidgetParamFieldContract,
  value: unknown,
  params: Record<string, unknown>,
  options: WidgetParamsNormalizationOptions
): unknown {
  if (value == null) return undefined
  if (contract.field === 'portfolioIdentity') {
    const normalized = toPortfolioValueObject(value) ?? undefined
    return normalized ?? invalidFieldValue(contract, options, 'must be a portfolio identity')
  }
  if (contract.field === 'providerParams') {
    if (!isRecord(value)) return invalidFieldValue(contract, options, 'must be an object')
    return sanitizeMarketProviderParamsForWidget(normalizeString(params.provider), value)
  }
  if (contract.field === 'marketProviderParams') {
    if (!isRecord(value)) return invalidFieldValue(contract, options, 'must be an object')
    return sanitizeMarketProviderParamsForWidget(normalizeString(params.marketProvider), value)
  }
  if (contract.field === 'auth' || contract.field === 'marketAuth') {
    if (!isRecord(value)) return invalidFieldValue(contract, options, 'must be an object')
    return sanitizeMarketProviderAuth(value)
  }
  if (contract.field === 'runtime') {
    return sanitizeRuntimeRefreshAt(value, options)
  }

  switch (contract.kind) {
    case 'entity-reference':
    case 'string': {
      return typeof value === 'string'
        ? normalizeString(value)
        : invalidFieldValue(contract, options, 'must be a string')
    }
    case 'listing': {
      const normalized = normalizeListingIdentity(value) ?? undefined
      return normalized ?? invalidFieldValue(contract, options, 'must be a listing identity')
    }
    case 'enum': {
      if (typeof value !== 'string') {
        return invalidFieldValue(contract, options, 'must be a string')
      }
      const normalized = normalizeString(value)
      if (!normalized) return undefined
      if (contract.allowedValues?.includes(normalized)) return normalized
      return invalidFieldValue(
        contract,
        options,
        `must be one of ${contract.allowedValues?.join(', ')}`
      )
    }
    case 'record':
      return isRecord(value)
        ? { ...value }
        : invalidFieldValue(contract, options, 'must be an object')
    case 'json': {
      const normalized = sanitizeJsonValue(value)
      return normalized ?? invalidFieldValue(contract, options, 'must be valid JSON')
    }
  }
}

function invalidFieldValue(
  contract: WidgetParamFieldContract,
  options: WidgetParamsNormalizationOptions,
  message: string
): undefined {
  if (options.strictUnknown) failWidgetContractField(`params.${contract.field}`, message)
  return undefined
}

function sanitizeRuntimeRefreshAt(value: unknown, options: WidgetParamsNormalizationOptions) {
  if (!isRecord(value)) {
    return invalidFieldValue(FIELD_CONTRACTS.runtime, options, 'must be an object')
  }
  if (value.refreshAt == null) return undefined
  if (typeof value.refreshAt !== 'number' || !Number.isFinite(value.refreshAt)) {
    return invalidFieldValue(FIELD_CONTRACTS.runtime, options, 'refreshAt must be a finite number')
  }
  return { refreshAt: value.refreshAt }
}

function cloneWidgetParams(params: Record<string, unknown> | null | undefined) {
  if (!params) return null
  return JSON.parse(JSON.stringify(params)) as Record<string, unknown>
}
