import {
  type LinkedPairColor,
  normalizePairColorContext,
  type PairColorContext,
  type PersistedColorPair,
  type PersistedColorPairsState,
  readPairColorContext,
} from '@/widgets/color-pairs'
import { type LayoutNode, normalizeColorPairsState, type WidgetInstance } from '@/widgets/layout'
import { isPairColor } from '@/widgets/pair-colors'
import {
  WIDGET_KEYS,
  type WidgetCatalogItem,
  type WidgetContract,
  WidgetContractValidationError,
  type WidgetKey,
  type WidgetMetadataProfile,
  type WidgetParamField,
} from '@/widgets/widget-contract-types'
import { copilotWidgetContract } from '@/widgets/widgets/copilot/contract'
import { dataChartWidgetContract } from '@/widgets/widgets/data_chart/contract'
import { customToolEditorWidgetContract } from '@/widgets/widgets/editor_custom_tool/contract'
import { indicatorEditorWidgetContract } from '@/widgets/widgets/editor_indicator/contract'
import { mcpEditorWidgetContract } from '@/widgets/widgets/editor_mcp/contract'
import { skillEditorWidgetContract } from '@/widgets/widgets/editor_skill/contract'
import { workflowEditorWidgetContract } from '@/widgets/widgets/editor_workflow/contract'
import { heatmapWidgetContract } from '@/widgets/widgets/heatmap/contract'
import { customToolListWidgetContract } from '@/widgets/widgets/list_custom_tool/contract'
import { indicatorListWidgetContract } from '@/widgets/widgets/list_indicator/contract'
import { mcpListWidgetContract } from '@/widgets/widgets/list_mcp/contract'
import { skillListWidgetContract } from '@/widgets/widgets/list_skill/contract'
import { workflowListWidgetContract } from '@/widgets/widgets/list_workflow/contract'
import { portfolioSnapshotWidgetContract } from '@/widgets/widgets/portfolio_snapshot/contract'
import { quickOrderWidgetContract } from '@/widgets/widgets/quick_order/contract'
import { watchlistWidgetContract } from '@/widgets/widgets/watchlist/contract'
import { workflowChatWidgetContract } from '@/widgets/widgets/workflow_chat/contract'
import { workflowConsoleWidgetContract } from '@/widgets/widgets/workflow_console/contract'
import { workflowVariablesWidgetContract } from '@/widgets/widgets/workflow_variables/contract'

export type {
  WidgetCatalogItem,
  WidgetContract,
  WidgetEffectiveParamsResult,
  WidgetKey,
  WidgetMetadataProfile,
  WidgetParamField,
  WidgetParamFieldContract,
  WidgetParamMutationMode,
  WidgetParamsNormalizationOptions,
  WidgetReferenceParamField,
  WidgetSanitizeResult,
  WidgetValidationIssue,
} from '@/widgets/widget-contract-types'
export {
  isWidgetContractValidationError,
  WIDGET_KEYS,
  WidgetContractValidationError,
} from '@/widgets/widget-contract-types'
export * from '@/widgets/widget-entity-selection'

const WIDGET_CONTRACTS = Object.fromEntries(
  [
    dataChartWidgetContract,
    workflowListWidgetContract,
    workflowEditorWidgetContract,
    workflowChatWidgetContract,
    workflowConsoleWidgetContract,
    copilotWidgetContract,
    indicatorListWidgetContract,
    mcpListWidgetContract,
    indicatorEditorWidgetContract,
    mcpEditorWidgetContract,
    customToolListWidgetContract,
    customToolEditorWidgetContract,
    skillListWidgetContract,
    skillEditorWidgetContract,
    workflowVariablesWidgetContract,
    watchlistWidgetContract,
    portfolioSnapshotWidgetContract,
    quickOrderWidgetContract,
    heatmapWidgetContract,
  ].map((contract) => [contract.key, contract])
) as Record<WidgetKey, WidgetContract>

const WIDGET_KEY_SET = new Set<string>(WIDGET_KEYS)

export function isWidgetKey(value: unknown): value is WidgetKey {
  return typeof value === 'string' && WIDGET_KEY_SET.has(value)
}

export function assertWidgetKey(value: unknown): WidgetKey {
  if (!isWidgetKey(value)) {
    throw new Error(`Unknown widget key "${String(value)}"`)
  }
  return value
}

export function getWidgetContract(key: WidgetKey): WidgetContract {
  return WIDGET_CONTRACTS[key]
}

export function getDefaultWidgetInstance(key: WidgetKey): NonNullable<WidgetInstance> {
  return getWidgetContract(key).createDefaultInstance()
}

export function sanitizeWidgetInstance(
  value: unknown,
  options: { strict?: boolean } = {}
): WidgetInstance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const source = value as Record<string, unknown>
  const key = assertWidgetKey(source.key)
  return {
    key,
    pairColor: isPairColor(source.pairColor) ? source.pairColor : 'gray',
    params: sanitizeWidgetParams(key, source.params, {
      strictUnknown: options.strict === true,
    }),
  }
}

export function sanitizeWidgetParams(
  widgetKey: WidgetKey,
  params: unknown,
  options: { strictUnknown?: boolean } = {}
): Record<string, unknown> | null {
  return getWidgetContract(widgetKey).sanitizeLocalParams(params, options).params
}

export function mergeWidgetParams(
  widgetKey: WidgetKey,
  currentParams: Record<string, unknown> | null | undefined,
  incomingParams: Record<string, unknown>
): Record<string, unknown> | null {
  return getWidgetContract(widgetKey).mergeLocalParams(currentParams, incomingParams, 'patch')
    .params
}

export function splitWidgetParamsForColorPair(
  widgetKey: WidgetKey,
  pairColor: unknown,
  params: unknown
): {
  localParams: Record<string, unknown> | null
  pairContext: PairColorContext
} {
  if (pairColor !== 'gray' && !isPairColor(pairColor)) {
    throw new Error(`Unknown pairColor "${String(pairColor)}"`)
  }
  const split = getWidgetContract(widgetKey).splitPatchForPairColor(params, pairColor)
  return { localParams: split.localPatch, pairContext: split.linkedPatch }
}

export function resolveEffectiveWidgetParams(
  widget: WidgetInstance,
  colorPairs: PersistedColorPairsState | unknown
): Record<string, unknown> | null {
  if (!widget) return null
  const widgetKey = assertWidgetKey(widget.key)
  const pairColor = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
  if (pairColor === 'gray') {
    return getWidgetContract(widgetKey).sanitizeLocalParams(widget.params, {
      strictUnknown: false,
    }).params
  }
  return getWidgetContract(widgetKey).resolveEffectiveParams(
    widget,
    readPairColorContext(colorPairs, pairColor)
  ).params
}

export function normalizeWidgetColorPairPatch(
  widgetKey: WidgetKey,
  value: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!value) return {}

  const allowedFields = new Set(getWidgetContract(widgetKey).linkedParamFields)
  const unsupported = Object.keys(value).filter(
    (field) => !allowedFields.has(field as WidgetParamField)
  )
  if (unsupported.length > 0) {
    throw new WidgetContractValidationError(
      unsupported.map((field) => ({
        path: `colorPair.${field}`,
        message: `Widget "${widgetKey}" does not support this linked color-pair field`,
      }))
    )
  }

  const normalized = normalizePairColorContext(value)
  return Object.entries(value).reduce<Record<string, unknown>>((acc, [field, raw]) => {
    if (!allowedFields.has(field as WidgetParamField)) return acc
    if (raw === null) {
      acc[field] = null
    } else if (field in normalized) {
      acc[field] = normalized[field as keyof PairColorContext]
    }
    return acc
  }, {})
}

export function pruneDashboardColorPairsForLayout(
  layout: LayoutNode,
  colorPairs: PersistedColorPairsState | unknown
): PersistedColorPairsState {
  const supportedFieldsByColor = collectSupportedLinkedFieldsByColor(layout)
  const pairs: PersistedColorPair[] = []

  for (const pair of normalizeColorPairsState(colorPairs).pairs) {
    const supportedFields = supportedFieldsByColor.get(pair.color)
    if (!supportedFields || supportedFields.size === 0) continue

    const context = normalizePairColorContext(pair)
    const nextPair: PersistedColorPair = { color: pair.color }
    for (const field of supportedFields) {
      const value = context[field as keyof PairColorContext]
      if (value != null) {
        ;(nextPair as Record<string, unknown>)[field] = value
      }
    }
    if (Object.keys(nextPair).length > 1) {
      pairs.push(nextPair)
    }
  }

  return { pairs }
}

function collectSupportedLinkedFieldsByColor(
  node: LayoutNode,
  fieldsByColor: Map<LinkedPairColor, Set<WidgetParamField>> = new Map()
): Map<LinkedPairColor, Set<WidgetParamField>> {
  if (node.type === 'panel') {
    const widget = node.widget
    if (
      !widget ||
      !isWidgetKey(widget.key) ||
      !isPairColor(widget.pairColor) ||
      widget.pairColor === 'gray'
    ) {
      return fieldsByColor
    }
    const fields = getWidgetContract(widget.key).linkedParamFields
    if (fields.length === 0) return fieldsByColor
    const existing = fieldsByColor.get(widget.pairColor) ?? new Set<WidgetParamField>()
    for (const field of fields) {
      existing.add(field)
    }
    fieldsByColor.set(widget.pairColor, existing)
    return fieldsByColor
  }

  for (const child of node.children) {
    collectSupportedLinkedFieldsByColor(child, fieldsByColor)
  }
  return fieldsByColor
}

export function listWidgetCatalogItems(
  input: { category?: WidgetContract['category'] } = {}
): WidgetCatalogItem[] {
  return WIDGET_KEYS.map((key) => WIDGET_CONTRACTS[key])
    .filter((widget) => !input.category || widget.category === input.category)
    .map((contract) => ({
      widgetKey: contract.key,
      title: contract.title,
      category: contract.category,
      description: contract.description,
      editable: contract.editable,
      editableFields: [...contract.editableFields],
      linkedParamFields: [...contract.linkedParamFields],
    }))
}

export function readWidgetMetadataProfiles(widgetKeys: readonly string[]): WidgetMetadataProfile[] {
  return widgetKeys.map((widgetKey) => {
    const contract = getWidgetContract(assertWidgetKey(widgetKey))
    return {
      widgetKey: contract.key,
      title: contract.title,
      category: contract.category,
      description: contract.description,
      editable: contract.editable,
      defaultParams: contract.defaultParams,
      editableFields: [...contract.editableFields],
      paramContract: contract.paramContract,
      linkedParamFields: [...contract.linkedParamFields],
    }
  })
}
