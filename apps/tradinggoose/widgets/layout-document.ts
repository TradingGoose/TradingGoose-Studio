import { z } from 'zod'
import { ListingIdentitySchema, toListingValueObject } from '@/lib/listing/identity'
import {
  type LinkedPairColor,
  normalizePairColorContext,
  type PersistedColorPair,
} from '@/widgets/color-pairs'
import {
  createLayoutNodeId,
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  type PersistedColorPairsState,
  type WidgetInstance,
} from '@/widgets/layout'
import { isPairColor, PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import {
  getDefaultWidgetInstance,
  isWidgetKey,
  pruneDashboardColorPairsForLayout,
  resolveEffectiveWidgetParams,
  sanitizeWidgetInstance as sanitizeContractWidgetInstance,
  WIDGET_KEYS,
} from '@/widgets/widget-contracts'

export const DASHBOARD_LAYOUT_DOCUMENT_FORMAT = 'tg-dashboard-layout-document-v1' as const
export const DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT =
  'tg-dashboard-layout-structure-v1' as const

export type DashboardLayoutDocumentFields = {
  name: string
  layout: LayoutNode
  colorPairs: PersistedColorPairsState
  isActive: boolean
  sortOrder: number
}

export type DashboardLayoutValidationIssue = { path: string; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const WidgetKeySchema = z.enum(WIDGET_KEYS)
const PairColorSchema = z.enum(PAIR_COLORS as [PairColor, ...PairColor[]])
const LinkedPairColorSchema = z.enum(
  PAIR_COLORS.filter((color): color is LinkedPairColor => color !== 'gray') as [
    LinkedPairColor,
    ...LinkedPairColor[],
  ]
)

const DashboardLayoutWidgetInstanceSchema = z
  .object({
    key: WidgetKeySchema,
    pairColor: PairColorSchema.optional(),
    params: z.record(z.unknown()).nullable().optional(),
  })
  .strict()
  .nullable()

const DashboardLayoutNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([DashboardLayoutPanelNodeSchema, DashboardLayoutGroupNodeSchema])
)

const DashboardLayoutPanelNodeSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.literal('panel'),
    widget: DashboardLayoutWidgetInstanceSchema,
  })
  .strict()

const DashboardLayoutGroupNodeSchema: z.ZodTypeAny = z
  .object({
    id: z.string().trim().min(1),
    type: z.literal('group'),
    direction: z.enum(['horizontal', 'vertical']),
    sizes: z.array(z.number().finite().positive()),
    children: z.array(DashboardLayoutNodeSchema).min(1),
  })
  .strict()

const DashboardLayoutColorPairsSchema = z
  .object({
    pairs: z.array(
      z
        .object({
          color: LinkedPairColorSchema,
          workflowId: z.string().nullable().optional(),
          watchlistId: z.string().nullable().optional(),
          listing: ListingIdentitySchema.nullable().optional(),
          indicatorId: z.string().nullable().optional(),
          mcpServerId: z.string().nullable().optional(),
          customToolId: z.string().nullable().optional(),
          skillId: z.string().nullable().optional(),
        })
        .strict()
    ),
  })
  .strict()

export const DashboardLayoutDocumentSchema = z
  .object({
    name: z.string().trim().min(1),
    layout: DashboardLayoutNodeSchema,
    colorPairs: DashboardLayoutColorPairsSchema,
    isActive: z.boolean(),
    sortOrder: z.number().int(),
  })
  .strict()

const DashboardLayoutStructurePanelNodeSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('panel'),
    widget: z.object({ key: WidgetKeySchema }).strict().optional(),
  })
  .strict()

const DashboardLayoutStructureNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([DashboardLayoutStructurePanelNodeSchema, DashboardLayoutStructureGroupNodeSchema])
)

const DashboardLayoutStructureGroupNodeSchema: z.ZodTypeAny = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.literal('group'),
    direction: z.enum(['horizontal', 'vertical']),
    sizes: z.array(z.number().finite().positive()).optional(),
    children: z.array(DashboardLayoutStructureNodeSchema).min(1),
  })
  .strict()

export const DashboardLayoutStructureDocumentSchema = z
  .object({
    documentFormat: z.literal(DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT).optional(),
    layout: DashboardLayoutStructureNodeSchema,
    name: z.string().trim().min(1).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.literal(true).optional(),
  })
  .strict()

export class DashboardLayoutValidationError extends Error {
  constructor(public readonly issues: DashboardLayoutValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    this.name = 'DashboardLayoutValidationError'
  }
}

export function isDashboardLayoutValidationError(
  error: unknown
): error is DashboardLayoutValidationError {
  return error instanceof DashboardLayoutValidationError
}

export function createDashboardLayoutValidationError(
  path: string,
  message: string
): DashboardLayoutValidationError {
  return new DashboardLayoutValidationError([{ path, message }])
}

function failDashboardLayout(path: string, message: string): never {
  throw createDashboardLayoutValidationError(path, message)
}

export type DashboardLayoutReviewDiff = {
  before: DashboardLayoutDocumentFields
  after: DashboardLayoutDocumentFields
  addedPanelIds: string[]
  removedPanelIds: string[]
  retainedPanelIds: string[]
  changedPanelIds: string[]
  addedPanelCount: number
  removedPanelCount: number
  retainedPanelCount: number
  changedPanelCount: number
  groupSizeChanges: Array<{ groupId: string; before: number[]; after: number[] }>
  topologyChanged: boolean
  metadataChanges: Array<{
    field: 'name' | 'sortOrder' | 'isActive'
    before: string | number | boolean
    after: string | number | boolean
  }>
}

export function normalizeDashboardLayoutDocumentFields(
  fields: Partial<DashboardLayoutDocumentFields> & {
    layout?: LayoutNode | unknown
    colorPairs?: PersistedColorPairsState | unknown
  }
): DashboardLayoutDocumentFields {
  if (!isRecord(fields)) throw new Error('dashboard layout document fields must be an object')
  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  if (!name) throw new Error('dashboard layout document requires a non-empty name')
  for (const key of ['layout', 'colorPairs'] as const) {
    if (!Object.hasOwn(fields, key)) throw new Error(`dashboard layout document requires ${key}`)
  }
  if (typeof fields.isActive !== 'boolean')
    throw new Error('dashboard layout document requires boolean isActive')
  if (typeof fields.sortOrder !== 'number' || !Number.isInteger(fields.sortOrder)) {
    throw new Error('dashboard layout document requires an integer sortOrder')
  }

  return {
    name,
    layout: normalizeDocumentLayout(fields.layout),
    colorPairs: normalizeDocumentColorPairs(fields.colorPairs),
    isActive: fields.isActive,
    sortOrder: fields.sortOrder,
  }
}

function normalizeDocumentLayout(layout: unknown, path = 'layout'): LayoutNode {
  if (!isRecord(layout)) throw new Error(`${path} must be a layout node object`)
  if (typeof layout.id !== 'string' || !layout.id.trim())
    throw new Error(`${path}.id must be a non-empty string`)
  const id = layout.id.trim()

  if (layout.type === 'panel') {
    return { id, type: 'panel', widget: normalizeDocumentWidget(layout.widget, `${path}.widget`) }
  }
  if (layout.type !== 'group' || !Array.isArray(layout.children)) {
    throw new Error(`${path}.type must be "panel" or "group"`)
  }
  if (layout.direction !== 'horizontal' && layout.direction !== 'vertical') {
    throw new Error(`${path}.direction must be "horizontal" or "vertical"`)
  }
  if (layout.children.length === 0)
    throw new Error(`${path}.children must contain at least one node`)
  const children = layout.children.map((child, index) =>
    normalizeDocumentLayout(child, `${path}.children[${index}]`)
  )

  return {
    id,
    type: 'group',
    direction: layout.direction,
    sizes: readCanonicalGroupSizes(layout.sizes, children.length, `${path}.sizes`),
    children,
  }
}

function normalizeDocumentWidget(widget: unknown, path: string): WidgetInstance {
  if (widget === null) return null
  if (!isRecord(widget)) throw new Error(`${path} must be a widget object`)
  const key = typeof widget.key === 'string' ? widget.key.trim() : ''
  if (!key) throw new Error(`${path}.key must be a non-empty widget key`)
  if (!isWidgetKey(key)) throw new Error(`Unknown widget key "${key}"`)
  if (!isPairColor(widget.pairColor))
    throw new Error(`${path}.pairColor must be a valid pair color`)
  if (!Object.hasOwn(widget, 'params')) throw new Error(`${path}.params is required`)

  return sanitizeContractWidgetInstance(
    { key, pairColor: widget.pairColor, params: widget.params },
    { strict: true }
  )
}

function normalizeDocumentColorPairs(colorPairs: unknown): PersistedColorPairsState {
  if (!isRecord(colorPairs))
    throw new Error('dashboard layout document colorPairs must be an object')
  if (!Array.isArray(colorPairs.pairs))
    throw new Error('dashboard layout document colorPairs.pairs must be an array')
  colorPairs.pairs.forEach((pair, index) => {
    if (!isRecord(pair))
      throw new Error(`dashboard layout document colorPairs.pairs[${index}] must be an object`)
    if (!isPairColor(pair.color) || pair.color === 'gray') {
      throw new Error(
        `dashboard layout document colorPairs.pairs[${index}].color must be a linked pair color`
      )
    }
  })
  return normalizeColorPairsState(colorPairs)
}

function readCanonicalGroupSizes(value: unknown, childCount: number, path: string): number[] {
  if (!Array.isArray(value) || value.length !== childCount) {
    throw new Error(`${path} must contain one positive size per child`)
  }
  return value.map((size, index) => {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
      throw new Error(`${path}[${index}] must be a positive finite number`)
    }
    return size
  })
}

export function serializeDashboardLayoutDocument(
  fields: Partial<DashboardLayoutDocumentFields> & {
    layout?: LayoutNode | unknown
    colorPairs?: PersistedColorPairsState | unknown
  }
): string {
  return JSON.stringify(normalizeDashboardLayoutDocumentFields(fields), null, 2)
}

export function buildDashboardLayoutReviewDiff(
  beforeFields: DashboardLayoutDocumentFields,
  afterFields: DashboardLayoutDocumentFields
): DashboardLayoutReviewDiff {
  const before = normalizeDashboardLayoutDocumentFields(beforeFields)
  const after = normalizeDashboardLayoutDocumentFields(afterFields)
  const beforePanels = collectPanelWidgets(before.layout)
  const afterPanels = collectPanelWidgets(after.layout)
  const addedPanelIds = [...afterPanels.keys()].filter((panelId) => !beforePanels.has(panelId))
  const removedPanelIds = [...beforePanels.keys()].filter((panelId) => !afterPanels.has(panelId))
  const retainedPanelIds = [...afterPanels.keys()].filter((panelId) => beforePanels.has(panelId))
  const changedPanelIds = retainedPanelIds.filter(
    (panelId) =>
      JSON.stringify(beforePanels.get(panelId) ?? null) !==
      JSON.stringify(afterPanels.get(panelId) ?? null)
  )
  const afterGroups = collectGroupSizes(after.layout)
  const groupSizeChanges = [...collectGroupSizes(before.layout)].flatMap(
    ([groupId, beforeSizes]) => {
      const afterSizes = afterGroups.get(groupId)
      return afterSizes && JSON.stringify(beforeSizes) !== JSON.stringify(afterSizes)
        ? [{ groupId, before: beforeSizes, after: afterSizes }]
        : []
    }
  )
  const metadataChanges = (['name', 'sortOrder', 'isActive'] as const)
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }))

  return {
    before,
    after,
    addedPanelIds,
    removedPanelIds,
    retainedPanelIds,
    changedPanelIds,
    addedPanelCount: addedPanelIds.length,
    removedPanelCount: removedPanelIds.length,
    retainedPanelCount: retainedPanelIds.length,
    changedPanelCount: changedPanelIds.length,
    groupSizeChanges,
    topologyChanged:
      addedPanelIds.length > 0 ||
      removedPanelIds.length > 0 ||
      groupSizeChanges.length > 0 ||
      JSON.stringify(readLayoutTopology(before.layout)) !==
        JSON.stringify(readLayoutTopology(after.layout)),
    metadataChanges,
  }
}

export function applyLayoutEditDocument(
  currentFields: DashboardLayoutDocumentFields,
  entityDocument: string,
  removedPanelIds: readonly string[] = []
): DashboardLayoutDocumentFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(entityDocument)
  } catch {
    failDashboardLayout('entityDocument', 'entityDocument must be valid JSON')
  }
  if (!isRecord(parsed))
    failDashboardLayout('entityDocument', 'entityDocument must be a JSON object')

  const raw = parsed
  for (const key of ['colorPairs', 'colorPair'] as const) {
    if (raw[key] !== undefined) {
      failDashboardLayout(
        `entityDocument.${key}`,
        `edit_layout cannot modify ${key}; use edit_widget for linked color-pair params`
      )
    }
  }
  if (!isRecord(raw.layout)) {
    failDashboardLayout(
      'entityDocument.layout',
      'edit_layout entityDocument requires a top-level layout object'
    )
  }
  if (raw.isActive === false) {
    failDashboardLayout('entityDocument.isActive', 'edit_layout can only request isActive: true')
  }
  if (
    raw.documentFormat !== undefined &&
    raw.documentFormat !== DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT
  ) {
    failDashboardLayout(
      'entityDocument.documentFormat',
      `Unsupported edit_layout documentFormat "${String(raw.documentFormat)}". Expected ${DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT}`
    )
  }

  const currentLayout = normalizeDashboardLayout(currentFields.layout)
  const currentWidgets = collectPanelWidgets(currentLayout)
  const submittedLayout = reconcileStructureNode(raw.layout, '$.layout', {
    currentGroupIds: new Set(collectGroupSizes(currentLayout).keys()),
    currentWidgets,
    submittedIds: new Set(),
  })
  const submittedPanelIds = collectPanelIds(submittedLayout)
  if (submittedPanelIds.size === 0) {
    failDashboardLayout(
      'entityDocument.layout',
      'edit_layout entityDocument must contain at least one panel'
    )
  }

  const removed = new Set(removedPanelIds.map((id) => (typeof id === 'string' ? id.trim() : '')))
  if (removed.has('') || removed.size !== removedPanelIds.length) {
    failDashboardLayout('removedPanelIds', 'removedPanelIds must be unique non-empty panel ids')
  }
  for (const panelId of removed) {
    if (!currentWidgets.has(panelId)) {
      failDashboardLayout(
        'removedPanelIds',
        `removedPanelIds contains unknown panel id: ${panelId}`
      )
    }
    if (submittedPanelIds.has(panelId)) {
      failDashboardLayout(
        'removedPanelIds',
        `removedPanelIds still appear in edit_layout entityDocument: ${panelId}`
      )
    }
  }
  const missingRemovalIntents = [...currentWidgets.keys()].filter(
    (panelId) => !submittedPanelIds.has(panelId) && !removed.has(panelId)
  )
  if (missingRemovalIntents.length > 0) {
    failDashboardLayout(
      'removedPanelIds',
      `Existing panel ids omitted from edit_layout entityDocument without removedPanelIds: ${missingRemovalIntents.join(', ')}`
    )
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : currentFields.name
  if (raw.name !== undefined && !name) {
    failDashboardLayout('entityDocument.name', 'edit_layout name must be non-empty when provided')
  }
  if (
    raw.sortOrder !== undefined &&
    (typeof raw.sortOrder !== 'number' || !Number.isInteger(raw.sortOrder))
  ) {
    failDashboardLayout(
      'entityDocument.sortOrder',
      'edit_layout sortOrder must be an integer when provided'
    )
  }

  return {
    ...currentFields,
    name,
    layout: submittedLayout,
    colorPairs: pruneDashboardColorPairsForLayout(submittedLayout, currentFields.colorPairs),
    isActive: raw.isActive === true ? true : currentFields.isActive,
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : currentFields.sortOrder,
  }
}

function walkLayout(node: LayoutNode, visit: (node: LayoutNode) => void) {
  visit(node)
  if (node.type === 'group') node.children.forEach((child) => walkLayout(child, visit))
}

function collectPanelIds(node: LayoutNode): Set<string> {
  return new Set(collectPanelWidgets(node).keys())
}

function collectPanelWidgets(node: LayoutNode): Map<string, WidgetInstance> {
  const widgets = new Map<string, WidgetInstance>()
  walkLayout(node, (candidate) => {
    if (candidate.type === 'panel') widgets.set(candidate.id, candidate.widget)
  })
  return widgets
}

function collectGroupSizes(node: LayoutNode): Map<string, number[]> {
  const groups = new Map<string, number[]>()
  walkLayout(node, (candidate) => {
    if (candidate.type === 'group') groups.set(candidate.id, [...candidate.sizes])
  })
  return groups
}

function readLayoutTopology(node: LayoutNode): unknown {
  return node.type === 'panel'
    ? { type: 'panel', id: node.id }
    : {
        type: 'group',
        id: node.id,
        direction: node.direction,
        children: node.children.map(readLayoutTopology),
      }
}

type StructureReconcileContext = {
  currentGroupIds: ReadonlySet<string>
  currentWidgets: ReadonlyMap<string, WidgetInstance>
  submittedIds: Set<string>
}

function reconcileStructureNode(
  value: unknown,
  path: string,
  context: StructureReconcileContext
): LayoutNode {
  if (!isRecord(value)) failDashboardLayout(path, `${path} must be an object`)
  rejectForbiddenStructureNodeFields(value, path)

  const submittedId = readSubmittedId(value.id, path)
  if (submittedId) {
    if (context.submittedIds.has(submittedId)) {
      failDashboardLayout(
        'entityDocument.layout',
        `edit_layout entityDocument contains duplicate existing id: ${submittedId}`
      )
    }
    context.submittedIds.add(submittedId)
  }

  if (value.type === 'panel') {
    if (!submittedId) {
      return {
        id: createLayoutNodeId(),
        type: 'panel',
        widget: getDefaultWidgetInstance(readNewTargetWidgetKey(value.widget, `${path}.widget`)),
      }
    }
    const currentWidget = context.currentWidgets.get(submittedId)
    if (currentWidget === undefined) {
      failDashboardLayout(
        `${path}.id`,
        `edit_layout submitted panel id "${submittedId}" is not in the base layout`
      )
    }
    validateRetainedPanelWidget(value.widget, currentWidget, `${path}.widget`)
    return { id: submittedId, type: 'panel', widget: currentWidget }
  }

  if (value.type !== 'group')
    failDashboardLayout(`${path}.type`, `${path}.type must be "panel" or "group"`)
  if (submittedId && !context.currentGroupIds.has(submittedId)) {
    failDashboardLayout(
      `${path}.id`,
      `edit_layout submitted group id "${submittedId}" is not in the base layout`
    )
  }
  if (value.direction !== 'horizontal' && value.direction !== 'vertical') {
    failDashboardLayout(`${path}.direction`, `${path}.direction must be "horizontal" or "vertical"`)
  }
  if (!Array.isArray(value.children)) {
    failDashboardLayout(`${path}.children`, `${path}.children must be an array`)
  }
  if (value.children.length === 0) {
    failDashboardLayout(`${path}.children`, `${path}.children must contain at least one node`)
  }
  const children = value.children.map((child, index) =>
    reconcileStructureNode(child, `${path}.children[${index}]`, context)
  )

  return {
    id: submittedId ?? createLayoutNodeId(),
    type: 'group',
    direction: value.direction,
    sizes: normalizeGroupSizesForChildren(value.sizes, children.length),
    children,
  }
}

function readSubmittedId(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string')
    failDashboardLayout(`${path}.id`, `${path}.id must be a string when provided`)
  const trimmed = value.trim()
  if (!trimmed) failDashboardLayout(`${path}.id`, `${path}.id must be non-empty when provided`)
  return trimmed
}

function rejectForbiddenStructureNodeFields(raw: Record<string, unknown>, path: string) {
  for (const key of [
    'name',
    'sortOrder',
    'isActive',
    'colorPairs',
    'colorPair',
    'colorPairContext',
  ] as const) {
    if (raw[key] !== undefined) {
      failDashboardLayout(
        `${path}.${key}`,
        `edit_layout only accepts ${key} at supported top-level fields, not ${path}.${key}`
      )
    }
  }
  if (!isRecord(raw.widget)) return
  for (const key of [
    'params',
    'pairColor',
    'colorPairs',
    'colorPair',
    'colorPairContext',
  ] as const) {
    if (raw.widget[key] !== undefined) {
      failDashboardLayout(
        `${path}.widget.${key}`,
        `edit_layout cannot set widget ${key}; use edit_widget for widget config`
      )
    }
  }
}

function validateRetainedPanelWidget(
  rawWidget: unknown,
  currentWidget: WidgetInstance,
  path: string
) {
  if (rawWidget === undefined || rawWidget === null) return
  if (!isRecord(rawWidget)) failDashboardLayout(path, `${path} must be an object when provided`)
  const rawKey = rawWidget.key
  if (rawKey === undefined || rawKey === null) return
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    failDashboardLayout(`${path}.key`, `${path}.key must be a non-empty widget key when provided`)
  }
  const key = rawKey.trim()
  if (!isWidgetKey(key)) {
    failDashboardLayout(`${path}.key`, `Unknown widget key "${key}" in edit_layout entityDocument`)
  }
  if (!currentWidget?.key) {
    failDashboardLayout(
      `${path}.key`,
      `${path}.key cannot be provided because the retained panel has no widget key`
    )
  }
  if (key !== currentWidget.key) {
    failDashboardLayout(
      `${path}.key`,
      `edit_layout cannot replace widget key for retained panel "${currentWidget.key}" with "${key}"; use edit_widget`
    )
  }
}

function readNewTargetWidgetKey(rawWidget: unknown, path: string) {
  if (!isRecord(rawWidget)) {
    failDashboardLayout(path, `${path} with a valid key is required for new target-widget panels`)
  }
  const rawKey = rawWidget.key
  if (typeof rawKey !== 'string' || !rawKey.trim()) {
    failDashboardLayout(`${path}.key`, `${path}.key is required for new target-widget panels`)
  }
  const key = rawKey.trim()
  if (!isWidgetKey(key)) {
    failDashboardLayout(`${path}.key`, `Unknown widget key "${key}" in edit_layout entityDocument`)
  }
  return key
}

function normalizeGroupSizesForChildren(rawSizes: unknown, childCount: number): number[] {
  if (
    Array.isArray(rawSizes) &&
    rawSizes.length === childCount &&
    rawSizes.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
  ) {
    const total = rawSizes.reduce((sum, value) => sum + value, 0)
    if (total > 0) return rawSizes.map((value) => (value / total) * 100)
  }
  return new Array(childCount).fill(100 / Math.max(childCount, 1))
}

export function resolveEffectiveDashboardLayout(
  layout: LayoutNode | unknown,
  colorPairs: PersistedColorPairsState | unknown
): LayoutNode {
  const normalizedLayout = normalizeDashboardLayout(layout)
  const pairs = normalizeColorPairsForEffectiveProjection(colorPairs).pairs
  const hasLinkedPairs = pairs.some(
    (pair) => Object.keys(normalizePairColorContext(pair)).length > 0
  )
  if (!hasLinkedPairs) return normalizedLayout

  return applyPairMapToLayout(normalizedLayout, new Map(pairs.map((pair) => [pair.color, pair])))
}

function normalizeColorPairsForEffectiveProjection(
  colorPairs: PersistedColorPairsState | unknown
): PersistedColorPairsState {
  const normalized = normalizeColorPairsState(colorPairs)
  if (!isRecord(colorPairs) || !Array.isArray(colorPairs.pairs)) return normalized

  const canonicalByColor = new Map(normalized.pairs.map((pair) => [pair.color, pair] as const))
  const projectedPairs: PersistedColorPair[] = []
  const seen = new Set<LinkedPairColor>()

  for (const rawPair of colorPairs.pairs) {
    if (!isRecord(rawPair)) continue
    const color = rawPair.color
    if (!isPairColor(color) || color === 'gray' || seen.has(color)) continue
    seen.add(color)

    const canonicalPair = canonicalByColor.get(color)
    if (!canonicalPair) continue
    projectedPairs.push(
      toListingValueObject(rawPair.listing)
        ? { ...canonicalPair, listing: rawPair.listing as PersistedColorPair['listing'] }
        : canonicalPair
    )
  }

  return { pairs: projectedPairs }
}

function applyPairMapToLayout(
  node: LayoutNode,
  pairMap: ReadonlyMap<LinkedPairColor, PersistedColorPair>
): LayoutNode {
  if (node.type === 'panel') {
    const nextWidget = applyPairDataToWidget(node.widget, pairMap)
    return nextWidget === node.widget ? node : { ...node, widget: nextWidget }
  }

  const updatedChildren = node.children.map((child) => applyPairMapToLayout(child, pairMap))
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])
  return hasChanged ? { ...node, children: updatedChildren } : node
}

function applyPairDataToWidget(
  widget: WidgetInstance,
  pairMap: ReadonlyMap<LinkedPairColor, PersistedColorPair>
): WidgetInstance {
  if (!widget) return widget

  const pairColor: PairColor = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'
  if (pairColor === 'gray') return widget
  const pairData = pairMap.get(pairColor)
  if (!pairData) return widget

  const baseParams = isRecord(widget.params) ? { ...widget.params } : {}
  const effectiveParams = resolveEffectiveWidgetParams(
    { ...widget, params: baseParams },
    { pairs: [pairData] }
  )
  const projectedParams =
    isRecord(effectiveParams) &&
    'listing' in effectiveParams &&
    toListingValueObject(pairData.listing)
      ? { ...effectiveParams, listing: pairData.listing }
      : effectiveParams

  return { ...widget, params: projectedParams }
}
