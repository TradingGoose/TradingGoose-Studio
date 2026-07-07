import { getListingIdentityKey } from '@/lib/listing/identity'
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
import type { PairColor } from '@/widgets/pair-colors'

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
  description: string
  children?: WidgetParamFieldContract[]
}

type WidgetParamContractDef = Omit<WidgetParamFieldContract, 'field'>

export type WidgetReferenceParamCandidate = {
  field: WidgetReferenceParamField
  value: string
  path: string
}

const FIELD_DEFS = {
  workflowId: {
    kind: 'entity-reference',
    referenceKind: 'workflow',
    description: 'Workflow id from list_workflows.',
  },
  watchlistId: {
    kind: 'entity-reference',
    referenceKind: 'watchlist',
    description: 'Saved watchlist document id from list_watchlists.',
  },
  listing: {
    kind: 'listing',
    description: 'Normalized listing identity object; display hydration is read-only.',
  },
  indicatorId: {
    kind: 'entity-reference',
    referenceKind: 'indicator',
    description: 'Indicator runtime id from list_indicators.',
  },
  mcpServerId: {
    kind: 'entity-reference',
    referenceKind: 'mcp_server',
    description: 'MCP server id from list_mcp_servers.',
  },
  customToolId: {
    kind: 'entity-reference',
    referenceKind: 'custom_tool',
    description: 'Custom tool id from list_custom_tools.',
  },
  skillId: {
    kind: 'entity-reference',
    referenceKind: 'skill',
    description: 'Skill id from list_skills.',
  },
  provider: {
    kind: 'string',
    description: 'Trading or market-data provider id.',
  },
  providerParams: {
    kind: 'record',
    description: 'Provider-specific market-data parameter object.',
  },
  auth: {
    kind: 'record',
    description: 'Market-data auth settings; raw values and env-var placeholders are accepted.',
  },
  data: {
    kind: 'record',
    description: 'Widget data settings.',
  },
  view: {
    kind: 'record',
    description: 'Widget view settings.',
  },
  runtime: {
    kind: 'record',
    description: 'Runtime refresh/state hints persisted by widget controls.',
  },
  sourceMode: {
    kind: 'enum',
    allowedValues: ['watchlist', 'portfolio'],
    description: 'Heatmap source mode.',
  },
  watchlistSizeMetric: {
    kind: 'enum',
    allowedValues: ['volume', 'volumeUsd'],
    description: 'Heatmap watchlist sizing metric.',
  },
  marketProvider: { kind: 'string', description: 'Market-data provider id.' },
  marketProviderParams: {
    kind: 'record',
    description: 'Market-data provider parameter object.',
  },
  marketAuth: {
    kind: 'record',
    description: 'Market-data auth settings; raw values and env-var placeholders are accepted.',
  },
  tradingProvider: { kind: 'string', description: 'Trading provider id.' },
  serviceId: { kind: 'string', description: 'Provider service/account id.' },
  portfolioIdentity: {
    kind: 'json',
    description:
      'Trading account identity payload with providerId, credentialId, serviceId, and accountId.',
  },
  selectedWindow: {
    kind: 'string',
    description: 'Selected portfolio time window.',
  },
  side: {
    kind: 'enum',
    allowedValues: ['buy', 'sell'],
    description: 'Quick order side.',
  },
} satisfies Record<string, WidgetParamContractDef>

export type WidgetParamField = keyof typeof FIELD_DEFS

export const FIELD_CONTRACTS = Object.fromEntries(
  Object.entries(FIELD_DEFS).map(([field, def]) => [field, { field, ...def }])
) as Record<WidgetParamField, WidgetParamFieldContract>

export type WidgetParamsNormalizationOptions = { strictUnknown?: boolean }

export type WidgetParamMutationMode = 'patch' | 'replace'

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
  capabilities: string[]
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
  colorPairBehavior: {
    supportsLinkedPairs: boolean
    grayKeepsParamsLocal: boolean
    nonGrayLinkedFields: WidgetParamField[]
  }
  examples: Array<Record<string, unknown>>
  bestPractices: string[]
  validationHints: string[]
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
  examples: Array<Record<string, unknown>>
  bestPractices: string[]
  validationHints: string[]
  createDefaultInstance: () => NonNullable<WidgetInstance>
  sanitizeLocalParams: (
    params: unknown,
    options?: WidgetParamsNormalizationOptions
  ) => WidgetSanitizeResult
  mergeLocalParams: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>,
    mode?: WidgetParamMutationMode
  ) => WidgetSanitizeResult
  splitPatchForPairColor: (
    params: unknown,
    pairColor: PairColor
  ) => {
    localPatch: Record<string, unknown> | null
    linkedPatch: PairColorContext
    rejectedPaths: string[]
  }
  resolveEffectiveParams: (
    widget: WidgetInstance,
    pairContext: PairColorContext
  ) => WidgetEffectiveParamsResult
  resolveParamsForPairColorChange: (
    widget: WidgetInstance,
    nextPairColor: PairColor,
    colorPairs: { pairs: Array<PairColorContext & { color: string }> } | unknown
  ) => WidgetSanitizeResult
  collectReferenceParams: (params: unknown) => WidgetReferenceParamCandidate[]
  buildMetadataProfile: () => WidgetMetadataProfile
}

type ContractInput = Omit<
  WidgetContract,
  | 'paramContract'
  | 'createDefaultInstance'
  | 'sanitizeLocalParams'
  | 'mergeLocalParams'
  | 'splitPatchForPairColor'
  | 'resolveEffectiveParams'
  | 'resolveParamsForPairColorChange'
  | 'collectReferenceParams'
  | 'buildMetadataProfile'
> & {
  sanitizeLocalParams?: (
    params: unknown,
    options?: WidgetParamsNormalizationOptions
  ) => Record<string, unknown> | null
  mergeLocalParams?: (
    currentParams: Record<string, unknown> | null | undefined,
    incomingParams: Record<string, unknown>
  ) => Record<string, unknown> | null
  paramContract?: WidgetParamFieldContract[]
  collectAdditionalReferenceParams?: (
    params: Record<string, unknown> | null
  ) => WidgetReferenceParamCandidate[]
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
  const splitPatchForPairColor: WidgetContract['splitPatchForPairColor'] = (params, pairColor) => {
    const normalizedParams = sanitize(params, { strictUnknown: true })
    if (pairColor === 'gray' || !normalizedParams) {
      return {
        localPatch: normalizedParams,
        linkedPatch: {},
        rejectedPaths: [],
      }
    }

    const linkedFields = new Set<string>(input.linkedParamFields)
    const localPatch: Record<string, unknown> = {}
    const linkedPatch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(normalizedParams)) {
      ;(linkedFields.has(key) ? linkedPatch : localPatch)[key] = value
    }

    return {
      localPatch: Object.keys(localPatch).length > 0 ? localPatch : null,
      linkedPatch: normalizePairColorContext(linkedPatch),
      rejectedPaths: [],
    }
  }
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
    mergeLocalParams: (currentParams, incomingParams, mode = 'patch') => ({
      params:
        mode === 'replace'
          ? sanitize(incomingParams, { strictUnknown: true })
          : merge(currentParams, incomingParams),
      issues: [],
    }),
    splitPatchForPairColor,
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
    resolveParamsForPairColorChange(widget, nextPairColor) {
      return {
        params:
          nextPairColor === 'gray'
            ? sanitize(widget?.params, { strictUnknown: false })
            : splitPatchForPairColor(widget?.params ?? null, nextPairColor).localPatch,
        issues: [],
      }
    },
    collectReferenceParams(params) {
      const normalized = sanitize(params, { strictUnknown: true })
      return [
        ...collectDefaultReferenceParams(input.editableFields, normalized),
        ...(input.collectAdditionalReferenceParams?.(normalized) ?? []),
      ]
    },
    buildMetadataProfile: () => ({
      widgetKey: input.key,
      title: input.title,
      category: input.category,
      description: input.description,
      editable: input.editable,
      defaultParams: cloneWidgetParams(input.defaultParams),
      editableFields: [...input.editableFields],
      paramContract,
      linkedParamFields: [...input.linkedParamFields],
      colorPairBehavior: {
        supportsLinkedPairs: input.linkedParamFields.length > 0,
        grayKeepsParamsLocal: true,
        nonGrayLinkedFields: [...input.linkedParamFields],
      },
      examples: input.examples.map((example) => ({ ...example })),
      bestPractices: [...input.bestPractices],
      validationHints: [...input.validationHints],
    }),
  }
}

function collectDefaultReferenceParams(
  fields: readonly WidgetParamField[],
  normalized: Record<string, unknown> | null
): WidgetReferenceParamCandidate[] {
  if (!normalized) return []

  const references: WidgetReferenceParamCandidate[] = []
  for (const field of fields) {
    const fieldContract = FIELD_CONTRACTS[field]
    const value = normalized[field]
    if (fieldContract.kind === 'entity-reference' && typeof value === 'string') {
      references.push({
        field: field as WidgetReferenceParamField,
        value,
        path: field,
      })
    }
    if (fieldContract.kind === 'listing') {
      const listing = normalizeListingIdentity(value)
      if (listing) {
        references.push({
          field: 'listing',
          value: getListingIdentityKey(listing),
          path: field,
        })
      }
    }
  }

  return references
}

export function defineEntityWidgetContract(
  key: WidgetKey,
  title: string,
  category: WidgetCategory,
  description: string,
  field: WidgetReferenceParamField,
  exampleId: string,
  bestPractice: string,
  validationHint: string
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
    examples: [{ widgetKey: key, params: { [field]: exampleId } }],
    bestPractices: [bestPractice],
    validationHints: [validationHint],
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
