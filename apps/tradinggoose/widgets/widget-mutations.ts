import {
  type PairColorContext,
  readPairColorContext,
  removePairColorContext,
  upsertPairColorContext,
} from '@/widgets/color-pairs'
import type {
  LayoutNode,
  LinkedPairColor,
  PersistedColorPairsState,
  WidgetInstance,
} from '@/widgets/layout'
import { normalizeColorPairsState } from '@/widgets/layout'
import { isPairColor, PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import {
  collectWidgetReferenceCandidates,
  getDefaultWidgetInstance,
  getWidgetContract,
  isWidgetContractValidationError,
  isWidgetKey,
  mergeWidgetParams,
  normalizeWidgetColorPairPatch,
  resolveEffectiveWidgetParams,
  sanitizeWidgetInstance,
  sanitizeWidgetParams,
  splitWidgetParamsForColorPair,
  type WidgetKey,
  type WidgetReferenceParamField,
} from '@/widgets/widget-contracts'

export type WidgetConfigMutationPatch = {
  widgetKey?: unknown
  pairColor?: unknown
  params?: Record<string, unknown> | null
  paramsMode?: 'patch' | 'replace'
  colorPair?: Record<string, unknown> | null
  removedWidgetPanelIds?: readonly string[]
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

function guardWidgetConfig<T>(path: string, run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (isWidgetConfigValidationError(error)) throw error
    if (isWidgetContractValidationError(error)) throw new WidgetConfigValidationError(error.issues)
    failWidgetConfig(path, error instanceof Error ? error.message : 'Invalid widget configuration')
  }
}

export type WidgetReferenceValidationCandidate = {
  panelId: string
  field: WidgetReferenceParamField
  value: string
  path: string
}

export type WidgetReferenceValidationResult = {
  workspaceId: string
  ownerUserId: string
  panelId: string
  widgetKey: WidgetKey
  candidates: WidgetReferenceValidationCandidate[]
}

export type PlannedWidgetConfigMutation = {
  panelId: string
  beforeWidget: WidgetInstance
  afterWidget: WidgetInstance
  carriedPairContext: PairColorContext
  references: WidgetReferenceValidationCandidate[]
}

export type AppliedWidgetConfigMutation = PlannedWidgetConfigMutation & {
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  widget: WidgetInstance
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

type PanelNode = Extract<LayoutNode, { type: 'panel' }>

function findLayoutPanel(node: LayoutNode, panelId: string): PanelNode | null {
  if (node.type === 'panel') {
    return node.id === panelId ? node : null
  }
  for (const child of node.children) {
    const panel = findLayoutPanel(child, panelId)
    if (panel) return panel
  }
  return null
}

export function findLayoutPanelWidget(node: LayoutNode, panelId: string): WidgetInstance {
  return findLayoutPanel(node, panelId)?.widget ?? null
}

function updateLayoutPanelWidget(
  node: LayoutNode,
  panelId: string,
  widget: WidgetInstance
): LayoutNode {
  if (node.type === 'panel') {
    return node.id === panelId ? { ...node, widget: sanitizeWidgetInstance(widget) } : node
  }

  const children = node.children.map((child) => updateLayoutPanelWidget(child, panelId, widget))
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node
}

export function collectDashboardLayoutReferenceCandidates(
  layout: LayoutNode,
  colorPairs: PersistedColorPairsState | unknown
): WidgetReferenceValidationCandidate[] {
  const candidates: WidgetReferenceValidationCandidate[] = []

  const visit = (node: LayoutNode) => {
    if (node.type !== 'panel') {
      node.children.forEach(visit)
      return
    }
    const widget = node.widget
    if (!widget) return
    if (!isWidgetKey(widget.key)) return

    const references = collectWidgetReferenceCandidates(widget.key, widget.params)
    const pairColor = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
    if (pairColor !== 'gray') {
      references.push(
        ...collectWidgetReferenceCandidates(
          widget.key,
          readSupportedPairContextForWidget(widget.key, colorPairs, pairColor)
        )
      )
    }

    for (const reference of references) {
      candidates.push({
        panelId: node.id,
        field: reference.field,
        value: reference.value,
        path: `${node.id}.${reference.path}`,
      })
    }
  }

  visit(layout)
  return candidates
}

function readSupportedPairContextForWidget(
  widgetKey: WidgetKey,
  colorPairs: PersistedColorPairsState | unknown,
  pairColor: PairColor
): Record<string, unknown> {
  const context = readPairColorContext(colorPairs, pairColor)
  const supportedContext: Record<string, unknown> = {}

  for (const field of getWidgetContract(widgetKey).linkedParamFields) {
    const value = context[field as keyof PairColorContext]
    if (value != null) {
      supportedContext[field] = value
    }
  }

  return supportedContext
}

type WidgetConfigMutationInput = {
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  panelId: string
  patch: WidgetConfigMutationPatch
}

function computeWidgetConfigMutation(input: WidgetConfigMutationInput): {
  plan: PlannedWidgetConfigMutation
  pairPatch: Record<string, unknown>
} {
  const panel = findLayoutPanel(input.layout, input.panelId)
  if (!panel) {
    failWidgetConfig('panelId', `Unknown dashboard panel id: ${input.panelId}`)
  }
  const current = panel.widget
  const removedWidgetPanelIds = normalizeRemovedWidgetPanelIds(input.patch.removedWidgetPanelIds)
  const removesTargetWidget = removedWidgetPanelIds.has(input.panelId)
  if (removedWidgetPanelIds.size > 0 && !removesTargetWidget) {
    failWidgetConfig('removedWidgetPanelIds', 'edit_widget can only remove the target panel widget')
  }
  if (removesTargetWidget) {
    if (!current) {
      failWidgetConfig(
        'removedWidgetPanelIds',
        `Panel "${input.panelId}" does not have a widget to remove`
      )
    }
    if (
      input.patch.widgetKey !== undefined ||
      input.patch.pairColor !== undefined ||
      input.patch.params !== undefined ||
      input.patch.colorPair !== undefined
    ) {
      failWidgetConfig(
        'removedWidgetPanelIds',
        'Widget removal cannot be combined with widgetKey, pairColor, params, or colorPair edits'
      )
    }
    return {
      plan: {
        panelId: input.panelId,
        beforeWidget: current,
        afterWidget: null,
        carriedPairContext: {},
        references: [],
      },
      pairPatch: {},
    }
  }
  let currentKey: WidgetKey | null = null
  if (current && isWidgetKey(current.key)) {
    currentKey = current.key
  }
  const currentPairColor = current && isPairColor(current.pairColor) ? current.pairColor : 'gray'
  const nextKey: WidgetKey =
    input.patch.widgetKey === undefined
      ? currentKey
        ? currentKey
        : failWidgetConfig(
            'widgetKey',
            `A target widgetKey is required for empty panel "${input.panelId}"`
          )
      : isWidgetKey(input.patch.widgetKey)
        ? input.patch.widgetKey
        : failWidgetConfig('widgetKey', `Unknown widget key "${String(input.patch.widgetKey)}"`)
  const nextPairColor = resolveNextPairColor({
    pairColor: input.patch.pairColor,
    defaultPairColor: currentPairColor,
  })
  const { nextParams, widgetParams } = guardWidgetConfig('params', () => {
    const nextParams = sanitizeWidgetParams(
      nextKey,
      resolveMutationParams(current, nextKey, input.patch),
      {
        strictUnknown: true,
      }
    )
    const widgetParams = getWidgetContract(nextKey).resolveParamsForPairColorChange(
      { key: nextKey, pairColor: nextPairColor, params: nextParams },
      nextPairColor,
      input.colorPairs
    ).params
    return { nextParams, widgetParams }
  })
  const carriedPairContext = buildCarriedPairContext({
    beforeWidget: current,
    colorPairs: input.colorPairs,
    beforePairColor: currentPairColor,
    nextPairColor,
    nextKey,
  })
  const pairPatch = guardWidgetConfig('params', () =>
    nextPairColor === 'gray' || input.patch.colorPair === null
      ? {}
      : buildFinalPairPatch({
          widgetKey: nextKey,
          pairColor: nextPairColor,
          params: nextParams,
          colorPair: input.patch.colorPair,
          carriedPairContext,
        })
  )
  const references = guardWidgetConfig('params', () =>
    collectReferenceCandidates(input.panelId, nextKey, widgetParams, pairPatch)
  )

  return {
    plan: {
      panelId: input.panelId,
      beforeWidget: current,
      afterWidget: {
        key: nextKey,
        pairColor: nextPairColor,
        params: widgetParams,
      },
      carriedPairContext,
      references,
    },
    pairPatch,
  }
}

export function planWidgetConfigMutation(
  input: WidgetConfigMutationInput
): PlannedWidgetConfigMutation {
  return computeWidgetConfigMutation(input).plan
}

export function applyWidgetConfigMutation(
  input: WidgetConfigMutationInput & {
    referenceValidationScope?: { workspaceId: string; ownerUserId: string }
    referenceValidation?: WidgetReferenceValidationResult
  }
): AppliedWidgetConfigMutation {
  const { plan, pairPatch } = computeWidgetConfigMutation(input)
  assertReferenceValidation(plan, input.referenceValidation, input.referenceValidationScope)
  const widget = plan.afterWidget
  if (widget && !isWidgetKey(widget.key)) {
    failWidgetConfig('widgetKey', `Unknown widget key for panel "${input.panelId}"`)
  }

  const layout = updateLayoutPanelWidget(input.layout, input.panelId, widget)
  const afterPairColor = widget && isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
  const unprunedColorPairs = widget
    ? buildNextColorPairs({
        colorPairs: input.colorPairs,
        pairColor: afterPairColor,
        colorPair: input.patch.colorPair,
        pairPatch,
      })
    : input.colorPairs
  const colorPairs = normalizeColorPairsState(unprunedColorPairs)

  return {
    ...plan,
    layout,
    colorPairs,
    widget,
    beforeEffectiveParams:
      plan.beforeWidget && isWidgetKey(plan.beforeWidget.key)
        ? resolveEffectiveWidgetParams(plan.beforeWidget, input.colorPairs)
        : null,
    afterEffectiveParams: widget ? resolveEffectiveWidgetParams(widget, colorPairs) : null,
    colorPairDiff: buildColorPairDiff(input.colorPairs, colorPairs),
    changedPaths: buildChangedPaths(plan.beforeWidget, widget, input.colorPairs, colorPairs),
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

function normalizeRemovedWidgetPanelIds(value: readonly string[] | undefined): Set<string> {
  if (value === undefined) return new Set()
  const ids = value.map((id) => (typeof id === 'string' ? id.trim() : ''))
  const unique = new Set(ids)
  if (unique.has('') || unique.size !== ids.length) {
    failWidgetConfig(
      'removedWidgetPanelIds',
      'removedWidgetPanelIds must be unique non-empty panel ids'
    )
  }
  return unique
}

function resolveMutationParams(
  current: WidgetInstance,
  nextKey: WidgetKey,
  patch: WidgetConfigMutationPatch
): Record<string, unknown> | null {
  const baseParams =
    nextKey === current?.key ? current?.params : getDefaultWidgetInstance(nextKey).params

  if (patch.params === undefined) return baseParams ?? null
  if (patch.params === null) return null

  const mode = patch.paramsMode === undefined ? 'patch' : patch.paramsMode
  if (mode !== 'patch' && mode !== 'replace') {
    failWidgetConfig('paramsMode', `Unknown widget params mutation mode "${String(mode)}"`)
  }

  return mode === 'replace' ? patch.params : mergeWidgetParams(nextKey, baseParams, patch.params)
}

function buildNextColorPairs(input: {
  colorPairs: PersistedColorPairsState
  pairColor: PairColor
  colorPair?: Record<string, unknown> | null
  pairPatch: Record<string, unknown>
}): PersistedColorPairsState {
  if (input.pairColor === 'gray') {
    if (input.colorPair && Object.keys(input.colorPair).length > 0) {
      failWidgetConfig('colorPair', 'edit_widget colorPair requires a non-gray pairColor')
    }
    return input.colorPairs
  }

  if (input.colorPair === null) {
    return removePairColorContext(input.colorPairs, input.pairColor)
  }

  return Object.keys(input.pairPatch).length > 0
    ? upsertPairColorContext(input.colorPairs, input.pairColor, input.pairPatch)
    : input.colorPairs
}

function collectReferenceCandidates(
  panelId: string,
  widgetKey: WidgetKey,
  params: Record<string, unknown> | null,
  pairPatch: Record<string, unknown>
): WidgetReferenceValidationCandidate[] {
  const references = [
    ...collectWidgetReferenceCandidates(widgetKey, params),
    ...collectWidgetReferenceCandidates(widgetKey, pairPatch),
  ]
  return references.map((reference) => ({
    panelId,
    field: reference.field,
    value: reference.value,
    path: `${panelId}.${reference.path}`,
  }))
}

function buildCarriedPairContext(input: {
  beforeWidget: WidgetInstance
  colorPairs: PersistedColorPairsState
  beforePairColor: PairColor
  nextPairColor: PairColor
  nextKey: WidgetKey
}): PairColorContext {
  if (
    input.nextPairColor === 'gray' ||
    input.nextPairColor === input.beforePairColor ||
    !input.beforeWidget ||
    !isWidgetKey(input.beforeWidget.key)
  ) {
    return {}
  }

  const linkedFields = getWidgetContract(input.nextKey).linkedParamFields
  if (linkedFields.length === 0) return {}

  const effectiveParams = resolveEffectiveWidgetParams(input.beforeWidget, input.colorPairs)
  if (!effectiveParams) return {}

  const targetContext = readPairColorContext(input.colorPairs, input.nextPairColor)
  const carryInput: Record<string, unknown> = {}
  for (const field of linkedFields) {
    const value = effectiveParams[field]
    if (value != null && targetContext[field as keyof PairColorContext] == null) {
      carryInput[field] = value
    }
  }

  if (Object.keys(carryInput).length === 0) return {}
  return splitWidgetParamsForColorPair(input.nextKey, input.nextPairColor, carryInput).pairContext
}

function buildFinalPairPatch(input: {
  widgetKey: WidgetKey
  pairColor: PairColor
  params: Record<string, unknown> | null
  colorPair?: Record<string, unknown> | null
  carriedPairContext?: PairColorContext
}): Record<string, unknown> {
  const split = splitWidgetParamsForColorPair(input.widgetKey, input.pairColor, input.params)
  const explicitPatch = normalizeWidgetColorPairPatch(input.widgetKey, input.colorPair)
  assertNoLinkedFieldConflicts(split.pairContext, explicitPatch)
  return {
    ...(input.carriedPairContext ?? {}),
    ...split.pairContext,
    ...explicitPatch,
  }
}

function assertReferenceValidation(
  plan: PlannedWidgetConfigMutation,
  proof: WidgetReferenceValidationResult | undefined,
  scope: { workspaceId: string; ownerUserId: string } | undefined
) {
  if (plan.references.length === 0) return
  if (!scope) {
    failWidgetConfig(
      'references',
      'Widget reference validation scope is required before applying this mutation'
    )
  }
  if (!proof) {
    failWidgetConfig(
      'references',
      'Widget reference validation proof is required before applying this mutation'
    )
  }
  if (proof.panelId !== plan.panelId || proof.widgetKey !== plan.afterWidget?.key) {
    failWidgetConfig('references', 'Widget reference validation proof does not match this mutation')
  }
  if (proof.workspaceId !== scope.workspaceId || proof.ownerUserId !== scope.ownerUserId) {
    failWidgetConfig(
      'references',
      'Widget reference validation proof scope does not match this mutation'
    )
  }

  const proven = new Set(proof.candidates.map(serializeReferenceCandidate))
  const missing = plan.references.filter(
    (candidate) => !proven.has(serializeReferenceCandidate(candidate))
  )
  if (missing.length > 0) {
    failWidgetConfig(
      'references',
      `Widget reference validation proof is missing: ${missing
        .map((candidate) => `${candidate.path}=${candidate.value}`)
        .join(', ')}`
    )
  }
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

function serializeReferenceCandidate(candidate: WidgetReferenceValidationCandidate): string {
  return `${candidate.panelId}:${candidate.path}:${candidate.field}:${candidate.value}`
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function assertNoLinkedFieldConflicts(
  fromParams: PairColorContext,
  explicitPatch: Record<string, unknown>
) {
  const issues: WidgetConfigValidationIssue[] = []
  for (const [field, value] of Object.entries(fromParams)) {
    if (!(field in explicitPatch) || areJsonValuesEqual(value, explicitPatch[field])) continue
    const message = `Conflicting linked colorPair field "${field}" submitted in params and colorPair`
    issues.push({ path: `params.${field}`, message }, { path: `colorPair.${field}`, message })
  }
  if (issues.length > 0) {
    throw new WidgetConfigValidationError(issues)
  }
}

function buildChangedPaths(
  beforeWidget: WidgetInstance,
  afterWidget: WidgetInstance,
  beforeColorPairs: PersistedColorPairsState,
  afterColorPairs: PersistedColorPairsState
): string[] {
  const changed: string[] = []
  if (beforeWidget?.key !== afterWidget?.key) changed.push('widget.key')
  if (beforeWidget?.pairColor !== afterWidget?.pairColor) changed.push('widget.pairColor')
  if (!areJsonValuesEqual(beforeWidget?.params, afterWidget?.params)) changed.push('widget.params')
  if (!areJsonValuesEqual(beforeColorPairs, afterColorPairs)) changed.push('colorPairs')
  return changed
}
