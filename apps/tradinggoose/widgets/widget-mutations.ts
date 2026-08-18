import {
  type PairColorContext,
  readPairColorContext,
  upsertPairColorContext,
} from '@/widgets/color-pairs'
import type { LinkedPairColor, PersistedColorPairsState, WidgetInstance } from '@/widgets/layout'
import { normalizeColorPairsState } from '@/widgets/layout'
import type { DashboardWidgetDocument } from '@/widgets/layout-document'
import { isPairColor, PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import {
  getWidgetContract,
  isWidgetContractValidationError,
  isWidgetKey,
  mergeWidgetParams,
  normalizeWidgetColorPairPatch,
  resolveEffectiveWidgetParams,
  sanitizeWidgetParams,
  stripLinkedWidgetParams,
  type WidgetKey,
} from '@/widgets/widget-contracts'

export type WidgetConfigMutationPatch = {
  pairColor?: unknown
  params?: Record<string, unknown> | null
  colorPair?: Record<string, unknown>
}

export type WidgetConfigValidationIssue = {
  path: string
  message: string
}

export class WidgetConfigValidationError extends Error {
  public readonly issues: WidgetConfigValidationIssue[]

  constructor(issues: WidgetConfigValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    this.name = 'WidgetConfigValidationError'
    this.issues = issues
  }
}

export function createWidgetConfigValidationError(
  path: string,
  message: string
): WidgetConfigValidationError {
  return new WidgetConfigValidationError([{ path, message }])
}

function failWidgetConfig(path: string, message: string): never {
  throw createWidgetConfigValidationError(path, message)
}

function withWidgetConfigErrors<T>(path: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof WidgetConfigValidationError) throw error
    if (isWidgetContractValidationError(error)) throw new WidgetConfigValidationError(error.issues)
    failWidgetConfig(path, error instanceof Error ? error.message : 'Invalid widget configuration')
  }
}

export type WidgetConfigMutationReviewBase = {
  params?: Record<string, unknown> | null
  colorPair?: {
    color: LinkedPairColor
    context: PairColorContext
  }
}

export type AppliedWidgetConfigMutation = {
  widgetDocument: DashboardWidgetDocument
  reviewBase: WidgetConfigMutationReviewBase
  colorPairs: PersistedColorPairsState
  colorPairDiff: Array<{
    color: PairColor
    before: PairColorContext
    after: PairColorContext
    changedFields: string[]
  }>
  widgetChanged: boolean
}

type WidgetConfigMutationInput = {
  origin: 'human' | 'copilot'
  widgetKey: string
  widget: DashboardWidgetDocument
  colorPairs: PersistedColorPairsState
  patch: WidgetConfigMutationPatch
}

function computeWidgetConfigMutation(input: WidgetConfigMutationInput): {
  widgetDocument: DashboardWidgetDocument
  pairPatch: Record<string, unknown>
  reviewBase: WidgetConfigMutationReviewBase
} {
  const currentKey = isWidgetKey(input.widgetKey)
    ? input.widgetKey
    : failWidgetConfig('widgetKey', `Unknown widget key "${String(input.widgetKey)}"`)
  const nextKey = currentKey
  const current: NonNullable<WidgetInstance> = { key: currentKey, ...input.widget }
  const currentPairColor = input.widget.pairColor
  const nextPairColor = resolveNextPairColor({
    pairColor: input.patch.pairColor,
    defaultPairColor: currentPairColor,
  })
  assertLinkedParamsUseColorPair(nextKey, nextPairColor, input.patch.params)
  const currentEffectiveParams = resolveEffectiveWidgetParams(current, input.colorPairs)
  const baseParams =
    currentPairColor !== 'gray' && nextPairColor === 'gray'
      ? currentEffectiveParams
      : current.params
  const sanitizedWidgetParams = withWidgetConfigErrors('params', () =>
    sanitizeWidgetParams(
      nextKey,
      resolveMutationParams(baseParams, nextKey, input.patch, input.origin),
      {
        strictUnknown: true,
      }
    )
  )
  const widgetParams =
    nextPairColor === 'gray'
      ? sanitizedWidgetParams
      : stripLinkedWidgetParams(nextKey, sanitizedWidgetParams)
  if (nextPairColor === 'gray' && input.patch.colorPair !== undefined) {
    failWidgetConfig('colorPair', 'edit_widget colorPair requires a non-gray pairColor')
  }
  const explicitPairPatch = withWidgetConfigErrors('colorPair', () =>
    input.patch.colorPair && nextPairColor !== 'gray'
      ? normalizeWidgetColorPairPatch(nextKey, input.patch.colorPair)
      : {}
  )
  const inheritedPairPatch =
    currentPairColor !== nextPairColor && nextPairColor !== 'gray'
      ? buildInheritedColorPairPatch({
          widgetKey: nextKey,
          effectiveParams: currentEffectiveParams,
          destination: readPairColorContext(input.colorPairs, nextPairColor),
        })
      : {}
  const pairPatch = { ...inheritedPairPatch, ...explicitPairPatch }
  const reviewBase = buildWidgetConfigMutationReviewBase({
    widgetKey: nextKey,
    current,
    nextPairColor,
    colorPairs: input.colorPairs,
    patch: input.patch,
    explicitPairPatch,
  })

  return {
    widgetDocument: {
      pairColor: nextPairColor,
      params: widgetParams,
    },
    pairPatch,
    reviewBase,
  }
}

export function applyWidgetConfigMutation(
  input: WidgetConfigMutationInput
): AppliedWidgetConfigMutation {
  const { widgetDocument, pairPatch, reviewBase } = computeWidgetConfigMutation(input)
  const afterPairColor = widgetDocument.pairColor
  const unprunedColorPairs = buildNextColorPairs({
    colorPairs: input.colorPairs,
    pairColor: afterPairColor,
    pairPatch,
  })
  const colorPairs = normalizeColorPairsState(unprunedColorPairs)
  const colorPairDiff = buildColorPairDiff(input.colorPairs, colorPairs)

  return {
    widgetDocument,
    reviewBase,
    colorPairs,
    colorPairDiff,
    widgetChanged: hasWidgetChanged(input.widget, widgetDocument),
  }
}

function buildWidgetConfigMutationReviewBase(input: {
  widgetKey: WidgetKey
  current: NonNullable<WidgetInstance>
  nextPairColor: PairColor
  colorPairs: PersistedColorPairsState
  patch: WidgetConfigMutationPatch
  explicitPairPatch: Record<string, unknown>
}): WidgetConfigMutationReviewBase {
  const contract = getWidgetContract(input.widgetKey)
  const params =
    input.patch.params === undefined
      ? undefined
      : input.patch.params === null
        ? contract.projectCopilotParams(input.current.params)
        : contract.projectCopilotParamsReviewBase(input.current.params, input.patch.params)
  const colorPairFields = Object.keys(input.explicitPairPatch)
  const tracksColorPair = input.nextPairColor !== 'gray' && colorPairFields.length > 0
  const currentColorPair = tracksColorPair
    ? readPairColorContext(input.colorPairs, input.nextPairColor)
    : undefined
  const colorPair = tracksColorPair
    ? {
        color: input.nextPairColor as LinkedPairColor,
        context: Object.fromEntries(
          colorPairFields.map((field) => [
            field,
            currentColorPair?.[field as keyof PairColorContext] ?? null,
          ])
        ),
      }
    : undefined

  return {
    ...(params === undefined ? {} : { params }),
    ...(colorPair === undefined ? {} : { colorPair }),
  }
}

function resolveNextPairColor({
  pairColor,
  defaultPairColor,
}: {
  pairColor: unknown
  defaultPairColor: PairColor
}): PairColor {
  if (pairColor === undefined) return defaultPairColor
  if (!isPairColor(pairColor)) {
    failWidgetConfig('pairColor', `Unknown pairColor "${String(pairColor)}"`)
  }
  return pairColor
}

function resolveMutationParams(
  baseParams: Record<string, unknown> | null | undefined,
  nextKey: WidgetKey,
  patch: WidgetConfigMutationPatch,
  origin: WidgetConfigMutationInput['origin']
): Record<string, unknown> | null {
  if (patch.params === undefined) return baseParams ?? null
  if (origin === 'copilot') {
    return getWidgetContract(nextKey).mergeCopilotParams(baseParams, patch.params)
  }
  return patch.params === null ? null : mergeWidgetParams(nextKey, baseParams, patch.params)
}

function assertLinkedParamsUseColorPair(
  widgetKey: WidgetKey,
  pairColor: PairColor,
  params: Record<string, unknown> | null | undefined
): void {
  if (pairColor === 'gray' || !params) return

  const linkedFields = new Set<string>(getWidgetContract(widgetKey).linkedParamFields)
  const issues = Object.keys(params)
    .filter((field) => linkedFields.has(field))
    .map((field) => ({
      path: `params.${field}`,
      message: `Shared color-pair field "${field}" must be updated through colorPair for non-gray widgets`,
    }))
  if (issues.length > 0) throw new WidgetConfigValidationError(issues)
}

function buildInheritedColorPairPatch(input: {
  widgetKey: WidgetKey
  effectiveParams: Record<string, unknown> | null
  destination: PairColorContext
}): Record<string, unknown> {
  const effectiveParams = input.effectiveParams
  if (!effectiveParams) return {}

  return Object.fromEntries(
    getWidgetContract(input.widgetKey).linkedParamFields.flatMap((field) => {
      if (Object.hasOwn(input.destination, field)) return []
      const value = effectiveParams[field]
      return value == null ? [] : [[field, value]]
    })
  )
}

function buildNextColorPairs(input: {
  colorPairs: PersistedColorPairsState
  pairColor: PairColor
  pairPatch: Record<string, unknown>
}): PersistedColorPairsState {
  if (input.pairColor === 'gray') return input.colorPairs

  return Object.keys(input.pairPatch).length > 0
    ? upsertPairColorContext(input.colorPairs, input.pairColor, input.pairPatch)
    : input.colorPairs
}

function buildColorPairDiff(
  beforeColorPairs: PersistedColorPairsState,
  afterColorPairs: PersistedColorPairsState
): AppliedWidgetConfigMutation['colorPairDiff'] {
  return PAIR_COLORS.filter((color): color is LinkedPairColor => color !== 'gray').flatMap(
    (color) => {
      const before = readPairColorContext(beforeColorPairs, color)
      const after = readPairColorContext(afterColorPairs, color)
      const changedFields = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
        .filter(
          (field) =>
            !areJsonValuesEqual(
              (before as Record<string, unknown>)[field],
              (after as Record<string, unknown>)[field]
            )
        )
        .sort()

      return changedFields.length > 0 ? [{ color, before, after, changedFields }] : []
    }
  )
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function hasWidgetChanged(
  beforeWidget: DashboardWidgetDocument,
  afterWidget: DashboardWidgetDocument
): boolean {
  return (
    beforeWidget.pairColor !== afterWidget.pairColor ||
    !areJsonValuesEqual(beforeWidget.params, afterWidget.params)
  )
}
