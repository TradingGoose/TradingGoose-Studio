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

function failWidgetContractField(path: string, message: string): never {
  throw new WidgetContractValidationError([{ path, message }])
}

export type WidgetSanitizeResult = {
  params: Record<string, unknown> | null
  issues: WidgetValidationIssue[]
}

export type WidgetEffectiveParamsResult = {
  params: Record<string, unknown> | null
  issues: WidgetValidationIssue[]
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
  paramContract: WidgetParamFieldContract[]
  linkedParamFields: WidgetParamField[]
  createDefaultInstance: () => NonNullable<WidgetInstance>
  sanitizeLocalParams: (
    params: unknown,
    options?: WidgetParamsNormalizationOptions
  ) => WidgetSanitizeResult
  mergeLocalParams: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>
  ) => WidgetSanitizeResult
  projectCopilotParams: (
    params: Record<string, unknown> | null | undefined
  ) => Record<string, unknown> | null
  mergeCopilotParams: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown> | null
  ) => WidgetSanitizeResult
  projectCopilotParamsReviewBase: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>
  ) => Record<string, unknown>
  resolveEffectiveParams: (
    widget: WidgetInstance,
    pairContext: PairColorContext
  ) => WidgetEffectiveParamsResult
}

type ContractInput = Omit<
  WidgetContract,
  | 'paramContract'
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
  paramContract?: WidgetParamFieldContract[]
}

export function defineWidgetContract(input: ContractInput): WidgetContract {
  const paramContract =
    input.paramContract ?? input.editableFields.map((field) => FIELD_CONTRACTS[field])
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
    paramContract,
    createDefaultInstance: () => ({
      key: input.key,
      pairColor: 'gray',
      params: cloneWidgetParams(input.defaultParams),
    }),
    sanitizeLocalParams: (params, options) => ({
      params: sanitize(params, options),
      issues: [],
    }),
    mergeLocalParams: (currentParams, incomingParams) => ({
      params: merge(currentParams, incomingParams),
      issues: [],
    }),
    projectCopilotParams: input.projectCopilotParams ?? ((params) => params ?? null),
    mergeCopilotParams:
      input.mergeCopilotParams ??
      ((currentParams, incomingParams) => ({
        params: incomingParams === null ? null : merge(currentParams, incomingParams),
        issues: [],
      })),
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

      return {
        params: Object.keys(localParams).length > 0 ? localParams : null,
        issues: [],
      }
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
    const value = normalizeFieldValue(FIELD_CONTRACTS[field], params[field], params)
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
  const currentRuntime = isRecord(currentParams?.runtime) ? currentParams.runtime : null
  const incomingRuntime = isRecord(incomingParams.runtime) ? incomingParams.runtime : null
  const mergedRuntime =
    currentRuntime || incomingRuntime
      ? { ...(currentRuntime ?? {}), ...(incomingRuntime ?? {}) }
      : undefined
  return sanitize(
    {
      ...(currentParams ?? {}),
      ...incomingParams,
      ...(mergedRuntime ? { runtime: mergedRuntime } : {}),
    },
    { strictUnknown: true }
  )
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
  params: Record<string, unknown>
): unknown {
  if (value == null) return undefined
  if (contract.field === 'portfolioIdentity') {
    return toPortfolioValueObject(value) ?? undefined
  }
  if (contract.field === 'providerParams') {
    return sanitizeMarketProviderParamsForWidget(normalizeString(params.provider), value)
  }
  if (contract.field === 'marketProviderParams') {
    return sanitizeMarketProviderParamsForWidget(normalizeString(params.marketProvider), value)
  }
  if (contract.field === 'auth' || contract.field === 'marketAuth') {
    return sanitizeMarketProviderAuth(value)
  }
  if (contract.field === 'runtime') {
    return sanitizeRuntimeRefreshAt(value)
  }

  switch (contract.kind) {
    case 'entity-reference':
    case 'string':
      return normalizeString(value) || undefined
    case 'listing':
      return normalizeListingIdentity(value) ?? undefined
    case 'enum': {
      const normalized = normalizeString(value)
      if (!normalized) return undefined
      if (contract.allowedValues?.includes(normalized)) return normalized
      failWidgetContractField(
        `params.${contract.field}`,
        `must be one of ${contract.allowedValues?.join(', ')}`
      )
      return undefined
    }
    case 'record':
      return isRecord(value) ? { ...value } : undefined
    case 'json':
      return sanitizeJsonValue(value)
  }
}

function sanitizeRuntimeRefreshAt(value: unknown) {
  const runtime = isRecord(value) ? value : null
  const refreshAt =
    typeof runtime?.refreshAt === 'number' && Number.isFinite(runtime.refreshAt)
      ? runtime.refreshAt
      : undefined
  return refreshAt === undefined ? undefined : { refreshAt }
}

function cloneWidgetParams(params: Record<string, unknown> | null | undefined) {
  if (!params) return null
  return JSON.parse(JSON.stringify(params)) as Record<string, unknown>
}
