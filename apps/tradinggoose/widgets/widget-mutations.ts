import {
  type PairColorContext,
  readPairColorContext,
  removePairColorContext,
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
  type WidgetKey,
} from '@/widgets/widget-contracts'

export type WidgetConfigMutationPatch = {
  pairColor?: unknown
  params?: Record<string, unknown> | null
  paramsMode?: 'patch' | 'replace'
  colorPair?: Record<string, unknown> | null
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

export function isWidgetConfigValidationError(
  error: unknown
): error is WidgetConfigValidationError {
  return error instanceof WidgetConfigValidationError
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
    if (isWidgetConfigValidationError(error)) throw error
    if (isWidgetContractValidationError(error)) throw new WidgetConfigValidationError(error.issues)
    failWidgetConfig(path, error instanceof Error ? error.message : 'Invalid widget configuration')
  }
}

export type PlannedWidgetConfigMutation = {
  panelId: string
  beforeWidgetDocument: DashboardWidgetDocument
  widgetKey: WidgetKey
  widgetDocument: DashboardWidgetDocument
}

export type AppliedWidgetConfigMutation = PlannedWidgetConfigMutation & {
  colorPairs: PersistedColorPairsState
  beforeEffectiveParams: Record<string, unknown> | null
  afterEffectiveParams: Record<string, unknown> | null
  colorPairDiff: Array<{
    color: PairColor
    before: PairColorContext
    after: PairColorContext
    changedFields: string[]
  }>
  changedPaths: string[]
  warnings: string[]
  issues: string[]
}

type WidgetConfigMutationInput = {
  widgetKey: string
  widget: DashboardWidgetDocument
  colorPairs: PersistedColorPairsState
  panelId: string
  patch: WidgetConfigMutationPatch
}

function computeWidgetConfigMutation(input: WidgetConfigMutationInput): {
  plan: PlannedWidgetConfigMutation
  pairPatch: Record<string, unknown>
} {
  const currentKey = isWidgetKey(input.widgetKey)
    ? input.widgetKey
    : failWidgetConfig('widgetKey', `Unknown widget key "${String(input.widgetKey)}"`)
  const nextKey = currentKey
  const current: NonNullable<WidgetInstance> = { key: currentKey, ...input.widget }
  const currentPairColor = isPairColor(current.pairColor) ? current.pairColor : 'gray'
  const nextPairColor = resolveNextPairColor({
    pairColor: input.patch.pairColor,
    defaultPairColor: currentPairColor,
  })
  assertLinkedParamsUseColorPair(nextKey, nextPairColor, input.patch.params)
  const widgetParams = withWidgetConfigErrors('params', () =>
    sanitizeWidgetParams(nextKey, resolveMutationParams(current, nextKey, input.patch), {
      strictUnknown: true,
    })
  )
  if (nextPairColor === 'gray' && input.patch.colorPair !== undefined) {
    failWidgetConfig('colorPair', 'edit_widget colorPair requires a non-gray pairColor')
  }
  const pairPatch = withWidgetConfigErrors('colorPair', () =>
    input.patch.colorPair && nextPairColor !== 'gray'
      ? normalizeWidgetColorPairPatch(nextKey, input.patch.colorPair)
      : {}
  )

  return {
    plan: {
      panelId: input.panelId,
      beforeWidgetDocument: input.widget,
      widgetKey: nextKey,
      widgetDocument: {
        pairColor: nextPairColor,
        params: widgetParams,
      },
    },
    pairPatch,
  }
}

export function applyWidgetConfigMutation(
  input: WidgetConfigMutationInput
): AppliedWidgetConfigMutation {
  const { plan, pairPatch } = computeWidgetConfigMutation(input)
  const beforeWidget: NonNullable<WidgetInstance> = {
    key: plan.widgetKey,
    ...plan.beforeWidgetDocument,
  }
  const widget: NonNullable<WidgetInstance> = {
    key: plan.widgetKey,
    ...plan.widgetDocument,
  }
  const afterPairColor = plan.widgetDocument.pairColor
  const unprunedColorPairs = buildNextColorPairs({
    colorPairs: input.colorPairs,
    pairColor: afterPairColor,
    colorPair: input.patch.colorPair,
    pairPatch,
  })
  const colorPairs = normalizeColorPairsState(unprunedColorPairs)
  const colorPairDiff = buildColorPairDiff(input.colorPairs, colorPairs)

  return {
    ...plan,
    colorPairs,
    beforeEffectiveParams: resolveEffectiveWidgetParams(beforeWidget, input.colorPairs),
    afterEffectiveParams: resolveEffectiveWidgetParams(widget, colorPairs),
    colorPairDiff,
    changedPaths: buildChangedPaths(beforeWidget, widget, colorPairDiff),
    warnings: [],
    issues: [],
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
  current: NonNullable<WidgetInstance>,
  nextKey: WidgetKey,
  patch: WidgetConfigMutationPatch
): Record<string, unknown> | null {
  const baseParams = current.params

  if (patch.params === undefined) return baseParams ?? null
  if (patch.params === null) return null

  const mode = patch.paramsMode === undefined ? 'patch' : patch.paramsMode
  if (mode !== 'patch' && mode !== 'replace') {
    failWidgetConfig('paramsMode', `Unknown widget params mutation mode "${String(mode)}"`)
  }

  return mode === 'replace' ? patch.params : mergeWidgetParams(nextKey, baseParams, patch.params)
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

function buildNextColorPairs(input: {
  colorPairs: PersistedColorPairsState
  pairColor: PairColor
  colorPair?: Record<string, unknown> | null
  pairPatch: Record<string, unknown>
}): PersistedColorPairsState {
  if (input.colorPair === undefined) return input.colorPairs
  if (input.pairColor === 'gray') {
    failWidgetConfig('colorPair', 'edit_widget colorPair requires a non-gray pairColor')
  }

  if (input.colorPair === null) {
    return removePairColorContext(input.colorPairs, input.pairColor)
  }

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

function buildChangedPaths(
  beforeWidget: NonNullable<WidgetInstance>,
  afterWidget: NonNullable<WidgetInstance>,
  colorPairDiff: AppliedWidgetConfigMutation['colorPairDiff']
): string[] {
  const changed: string[] = []
  if (beforeWidget.pairColor !== afterWidget.pairColor) changed.push('widget.pairColor')
  if (!areJsonValuesEqual(beforeWidget.params, afterWidget.params)) changed.push('widget.params')
  if (colorPairDiff.length > 0) changed.push('colorPairs')
  return changed
}
