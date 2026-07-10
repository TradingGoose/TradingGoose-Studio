import { isEqual } from 'lodash'
import { z } from 'zod'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import type { LinkedPairColor } from '@/widgets/color-pairs'
import {
  createDefaultColorPairsState,
  createDefaultLayoutState,
  createLayoutNodeId,
  type LayoutNode,
  normalizeColorPairsState,
  type PersistedColorPairsState,
} from '@/widgets/layout'
import { PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import {
  getDefaultWidgetInstance,
  isWidgetContractValidationError,
  isWidgetKey,
  sanitizeWidgetInstance,
  WIDGET_KEYS,
} from '@/widgets/widget-contracts'

export const DASHBOARD_LAYOUT_DOCUMENT_FORMAT = 'tg-dashboard-layout-document-v2' as const
export const DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT =
  'tg-dashboard-layout-structure-v2' as const

export type DashboardWidgetDocument = {
  pairColor: PairColor
  params: Record<string, unknown> | null
}

export type DashboardWidgetsState = Record<string, DashboardWidgetDocument>

export type DashboardLayoutTopologyNode =
  | {
      id: string
      type: 'panel'
      identityId: string
      widgetKey: (typeof WIDGET_KEYS)[number] | null
    }
  | {
      id: string
      type: 'group'
      direction: 'horizontal' | 'vertical'
      sizes: number[]
      children: DashboardLayoutTopologyNode[]
    }

export type DashboardLayoutDocumentContent = {
  layout: DashboardLayoutTopologyNode
  widgets: DashboardWidgetsState
  colorPairs: PersistedColorPairsState
}

export type DashboardLayoutValidationIssue = { path: string; message: string }

export type DashboardLayoutEditPlan = {
  layout: DashboardLayoutTopologyNode
  createdWidgets: DashboardWidgetsState
  removedIdentityIds: string[]
}

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

const DashboardLayoutNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([DashboardLayoutPanelNodeSchema, DashboardLayoutGroupNodeSchema])
)

export const DashboardLayoutPanelNodeSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.literal('panel'),
    identityId: z.string().trim().min(1),
    widgetKey: WidgetKeySchema.nullable(),
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
  .refine((node) => node.sizes.length === node.children.length, {
    path: ['sizes'],
    message: 'sizes must contain one positive size per child',
  })

const DashboardLayoutStructureNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({ id: z.string().trim().min(1), type: z.literal('panel') }).strict(),
    z
      .object({
        id: z.string().trim().min(1),
        type: z.literal('panel'),
        widget: z.object({ key: WidgetKeySchema }).strict(),
      })
      .strict(),
    z
      .object({ type: z.literal('panel'), widget: z.object({ key: WidgetKeySchema }).strict() })
      .strict(),
    z
      .object({
        id: z.string().trim().min(1).optional(),
        type: z.literal('group'),
        direction: z.enum(['horizontal', 'vertical']),
        sizes: z.array(z.number().finite().positive()),
        children: z.array(DashboardLayoutStructureNodeSchema).min(1),
      })
      .strict()
      .refine((node) => node.sizes.length === node.children.length, {
        path: ['sizes'],
        message: 'sizes must contain one positive size per child',
      }),
  ])
)

export const DashboardLayoutStructureDocumentSchema = z
  .object({ layout: DashboardLayoutStructureNodeSchema })
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
  .refine(
    ({ pairs }) => new Set(pairs.map((pair) => pair.color)).size === pairs.length,
    'colorPairs cannot contain duplicate colors'
  )

export const DashboardWidgetDocumentSchema = z
  .object({
    pairColor: PairColorSchema,
    params: z.record(z.unknown()).nullable(),
  })
  .strict()

const DashboardWidgetsSchema = z.record(DashboardWidgetDocumentSchema)

export const DashboardLayoutDocumentContentSchema = z
  .object({
    layout: DashboardLayoutNodeSchema,
    widgets: DashboardWidgetsSchema,
    colorPairs: DashboardLayoutColorPairsSchema,
  })
  .strict()

export class DashboardLayoutValidationError extends Error {
  public readonly issues: DashboardLayoutValidationIssue[]

  constructor(issues: DashboardLayoutValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
    this.name = 'DashboardLayoutValidationError'
    this.issues = issues
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

function joinValidationPath(prefix: string, path: PropertyKey[]): string {
  const suffix = path.map(String).join('.')
  if (!prefix) return suffix || 'document'
  return suffix ? `${prefix}.${suffix}` : prefix
}

function flattenZodIssue(issue: z.ZodIssue): z.ZodIssue[] {
  return issue.code === 'invalid_union'
    ? issue.unionErrors.flatMap((error) => error.issues.flatMap(flattenZodIssue))
    : [issue]
}

function zodValidationError(error: z.ZodError, prefix = ''): DashboardLayoutValidationError {
  return new DashboardLayoutValidationError(
    error.issues.flatMap(flattenZodIssue).map((issue) => ({
      path: joinValidationPath(prefix, issue.path),
      message: issue.message,
    }))
  )
}

type DashboardPanelTopologyNode = Extract<DashboardLayoutTopologyNode, { type: 'panel' }>
type DashboardTopologyReferences = Map<string, DashboardPanelTopologyNode['widgetKey']>

function collectDashboardTopologyReferences(
  layout: DashboardLayoutTopologyNode
): DashboardTopologyReferences {
  const references: DashboardTopologyReferences = new Map()
  const nodeIds = new Set<string>()

  const visit = (node: DashboardLayoutTopologyNode) => {
    if (nodeIds.has(node.id)) {
      failDashboardLayout('layout', `Dashboard layout contains duplicate node ${node.id}`)
    }
    nodeIds.add(node.id)

    if (node.type === 'group') {
      node.children.forEach(visit)
      return
    }
    if (references.has(node.identityId)) {
      failDashboardLayout(
        'layout',
        `Dashboard layout widget ${node.identityId} is referenced by multiple panels`
      )
    }
    references.set(node.identityId, node.widgetKey)
  }

  visit(layout)
  return references
}

function normalizeTopologyWithReferences(layout: unknown): {
  layout: DashboardLayoutTopologyNode
  references: DashboardTopologyReferences
} {
  const parsed = DashboardLayoutNodeSchema.safeParse(layout)
  if (!parsed.success) throw zodValidationError(parsed.error, 'layout')
  const normalized = parsed.data as DashboardLayoutTopologyNode
  return {
    layout: normalized,
    references: collectDashboardTopologyReferences(normalized),
  }
}

function defaultTopology(
  node: LayoutNode,
  widgets: DashboardWidgetsState
): DashboardLayoutTopologyNode {
  if (node.type === 'panel') {
    const identityId = createLayoutNodeId()
    widgets[identityId] = { pairColor: 'gray', params: null }
    return { id: node.id, type: 'panel', identityId, widgetKey: null }
  }
  return { ...node, children: node.children.map((child) => defaultTopology(child, widgets)) }
}

export function createDefaultDashboardLayoutContent(): DashboardLayoutDocumentContent {
  const widgets: DashboardWidgetsState = {}
  return {
    layout: defaultTopology(createDefaultLayoutState(), widgets),
    widgets,
    colorPairs: createDefaultColorPairsState(),
  }
}

export function resolveDashboardLayout(
  layout: DashboardLayoutTopologyNode,
  widgets: DashboardWidgetsState
): LayoutNode {
  const normalizedTopology = normalizeTopologyWithReferences(layout)
  const normalizedWidgets = normalizeDocumentWidgets(normalizedTopology.references, widgets)
  return resolveNormalizedDashboardLayout(normalizedTopology.layout, normalizedWidgets)
}

function resolveNormalizedDashboardLayout(
  layout: DashboardLayoutTopologyNode,
  widgets: DashboardWidgetsState
): LayoutNode {
  if (layout.type === 'panel') {
    const widget = widgets[layout.identityId]
    return {
      id: layout.id,
      type: 'panel',
      widget: layout.widgetKey
        ? { key: layout.widgetKey, pairColor: widget.pairColor, params: widget.params }
        : null,
    }
  }
  return {
    ...layout,
    children: layout.children.map((child) => resolveNormalizedDashboardLayout(child, widgets)),
  }
}

export function normalizeDashboardLayoutDocumentContent(
  fields: unknown
): DashboardLayoutDocumentContent {
  const result = DashboardLayoutDocumentContentSchema.safeParse(fields)
  if (!result.success) throw zodValidationError(result.error)
  const parsed = result.data as DashboardLayoutDocumentContent
  const references = collectDashboardTopologyReferences(parsed.layout)
  const widgets = normalizeDocumentWidgets(references, parsed.widgets)
  return {
    layout: parsed.layout,
    widgets,
    colorPairs: normalizeColorPairsState(parsed.colorPairs),
  }
}

export function normalizeDashboardLayoutTopology(layout: unknown): DashboardLayoutTopologyNode {
  return normalizeTopologyWithReferences(layout).layout
}

export function normalizeDashboardWidgetDocument(
  widgetKey: DashboardPanelTopologyNode['widgetKey'],
  value: unknown
): DashboardWidgetDocument {
  const parsed = DashboardWidgetDocumentSchema.safeParse(value)
  if (!parsed.success) throw zodValidationError(parsed.error, 'widget')
  return normalizeWidgetDocumentForKey(widgetKey, parsed.data, 'widget')
}

function normalizeWidgetDocumentForKey(
  widgetKey: DashboardPanelTopologyNode['widgetKey'],
  widget: DashboardWidgetDocument,
  path: string
): DashboardWidgetDocument {
  if (widgetKey !== null) return normalizeKeyedWidgetDocument(widgetKey, widget, path)
  if (widget.pairColor !== 'gray' || widget.params !== null) {
    failDashboardLayout(
      path,
      'A null-key dashboard widget must equal { pairColor: "gray", params: null }'
    )
  }
  return { pairColor: 'gray', params: null }
}

function normalizeKeyedWidgetDocument(
  widgetKey: (typeof WIDGET_KEYS)[number],
  widget: DashboardWidgetDocument,
  path: string
): DashboardWidgetDocument {
  let sanitized
  try {
    sanitized = sanitizeWidgetInstance({ key: widgetKey, ...widget }, { strict: true })
  } catch (error) {
    if (isWidgetContractValidationError(error)) {
      throw new DashboardLayoutValidationError(
        error.issues.map((issue) => ({
          path: joinValidationPath(path, issue.path.split('.')),
          message: issue.message,
        }))
      )
    }
    failDashboardLayout(path, error instanceof Error ? error.message : 'Widget is invalid')
  }
  if (!sanitized) failDashboardLayout(path, `Dashboard widget ${widgetKey} is invalid`)
  const params = sanitized.params ?? null
  if (!isEqual(widget.params, params)) {
    failDashboardLayout(`${path}.params`, `Dashboard widget ${widgetKey}.params must be canonical`)
  }
  return { pairColor: sanitized.pairColor ?? 'gray', params }
}

function normalizeDocumentWidgets(
  references: DashboardTopologyReferences,
  widgets: DashboardWidgetsState
): DashboardWidgetsState {
  const parsed = DashboardWidgetsSchema.safeParse(widgets)
  if (!parsed.success) throw zodValidationError(parsed.error, 'widgets')
  const source = parsed.data as DashboardWidgetsState
  const normalized: DashboardWidgetsState = {}
  for (const [identityId, widgetKey] of references) {
    const widget = source[identityId]
    if (!widget) {
      failDashboardLayout(
        `widgets.${identityId}`,
        `Dashboard layout references missing widget ${identityId}`
      )
    }
    const path = `widgets.${identityId}`
    normalized[identityId] = normalizeWidgetDocumentForKey(widgetKey, widget, path)
  }
  const orphan = Object.keys(source).find((identityId) => !references.has(identityId))
  if (orphan) {
    failDashboardLayout(`widgets.${orphan}`, `Dashboard layout contains orphan widget ${orphan}`)
  }
  return normalized
}

export function serializeDashboardLayoutDocument(content: DashboardLayoutDocumentContent): string {
  return JSON.stringify(normalizeDashboardLayoutDocumentContent(content), null, 2)
}

export function findDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panelId: string
): Extract<DashboardLayoutTopologyNode, { type: 'panel' }> | null {
  if (node.type === 'panel') return node.id === panelId ? node : null
  for (const child of node.children) {
    const found = findDashboardTopologyPanel(child, panelId)
    if (found) return found
  }
  return null
}

function planPanelWidgetBinding(
  panel: DashboardPanelTopologyNode | Pick<DashboardPanelTopologyNode, 'id' | 'type'>,
  widgetKey: string
): {
  panel: DashboardPanelTopologyNode
  createdWidgets: DashboardWidgetsState
  removedIdentityIds: string[]
} {
  if (!isWidgetKey(widgetKey)) {
    failDashboardLayout('widget.key', `Unknown widget key "${widgetKey}"`)
  }
  const current = 'identityId' in panel ? panel : null
  if (current?.widgetKey === widgetKey) {
    return { panel: current, createdWidgets: {}, removedIdentityIds: [] }
  }

  const widget = getDefaultWidgetInstance(widgetKey)
  const identityId = createLayoutNodeId()
  return {
    panel: { ...panel, identityId, widgetKey },
    createdWidgets: {
      [identityId]: {
        pairColor: widget.pairColor ?? 'gray',
        params: widget.params ?? null,
      },
    },
    removedIdentityIds: current ? [current.identityId] : [],
  }
}

function replaceTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panel: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>
): DashboardLayoutTopologyNode {
  if (node.type === 'panel') return node.id === panel.id ? panel : node
  const children = node.children.map((child) => replaceTopologyPanel(child, panel))
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node
}

export function replaceDashboardPanelWidget(
  current: DashboardLayoutDocumentContent,
  panelId: string,
  widgetKey: string
): DashboardLayoutEditPlan {
  const panel = findDashboardTopologyPanel(current.layout, panelId)
  if (!panel) failDashboardLayout('panelId', `Unknown panel: ${panelId}`)
  const binding = planPanelWidgetBinding(panel, widgetKey)
  const layout = replaceTopologyPanel(current.layout, binding.panel)
  const widgets = { ...current.widgets, ...binding.createdWidgets }
  for (const identityId of binding.removedIdentityIds) delete widgets[identityId]
  normalizeDashboardLayoutDocumentContent({ layout, widgets, colorPairs: current.colorPairs })
  return {
    layout,
    createdWidgets: binding.createdWidgets,
    removedIdentityIds: binding.removedIdentityIds,
  }
}

export function findDashboardTopologyParentGroupId(
  node: DashboardLayoutTopologyNode,
  childId: string,
  parentId: string | null = null
): string | null {
  if (node.type === 'panel') return node.id === childId ? parentId : null
  for (const child of node.children) {
    const found = findDashboardTopologyParentGroupId(child, childId, node.id)
    if (found) return found
  }
  return null
}

export function updateDashboardTopologyGroupSizes(
  node: DashboardLayoutTopologyNode,
  groupId: string,
  sizes: number[]
): DashboardLayoutTopologyNode {
  if (node.type === 'panel') return node
  if (node.id === groupId) {
    return isEqual(node.sizes, sizes) ? node : { ...node, sizes: [...sizes] }
  }
  const children = node.children.map((child) =>
    updateDashboardTopologyGroupSizes(child, groupId, sizes)
  )
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node
}

export function splitDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  widgets: DashboardWidgetsState,
  panelId: string,
  direction: 'horizontal' | 'vertical'
): DashboardLayoutEditPlan {
  const references = normalizeTopologyWithReferences(node).references
  const normalizedWidgets = normalizeDocumentWidgets(references, widgets)
  const createdWidgets: DashboardWidgetsState = {}
  const split = (current: DashboardLayoutTopologyNode): DashboardLayoutTopologyNode => {
    if (current.type === 'group') {
      const children = current.children.map(split)
      return children.some((child, index) => child !== current.children[index])
        ? { ...current, children }
        : current
    }
    if (current.id !== panelId) return current

    const cloneIdentityId = createLayoutNodeId()
    const source = normalizedWidgets[current.identityId]
    createdWidgets[cloneIdentityId] = {
      pairColor: source.pairColor,
      params: source.params,
    }
    return {
      id: createLayoutNodeId(),
      type: 'group',
      direction,
      sizes: [50, 50],
      children: [
        { ...current, id: createLayoutNodeId() },
        {
          ...current,
          id: createLayoutNodeId(),
          identityId: cloneIdentityId,
        },
      ],
    }
  }

  const layout = split(node)
  normalizeDocumentWidgets(normalizeTopologyWithReferences(layout).references, {
    ...widgets,
    ...createdWidgets,
  })
  return { layout, createdWidgets, removedIdentityIds: [] }
}

export function closeDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panelId: string
): DashboardLayoutEditPlan {
  normalizeDashboardLayoutTopology(node)
  const target = findDashboardTopologyPanel(node, panelId)
  const close = (current: DashboardLayoutTopologyNode): DashboardLayoutTopologyNode => {
    if (current.type === 'panel') return current
    const index = current.children.findIndex(
      (child) => child.type === 'panel' && child.id === panelId
    )
    if (index >= 0) {
      const children = current.children.filter((_, childIndex) => childIndex !== index)
      if (children.length === 0) return current
      if (children.length === 1) return { ...children[0], id: createLayoutNodeId() }
      const remainingSizes = current.sizes.filter((_, childIndex) => childIndex !== index)
      const total = remainingSizes.reduce((sum, size) => sum + size, 0) || children.length
      return {
        ...current,
        id: createLayoutNodeId(),
        children,
        sizes: remainingSizes.map((size) => (size / total) * 100),
      }
    }
    const children = current.children.map(close)
    return children.some((child, childIndex) => child !== current.children[childIndex])
      ? { ...current, children }
      : current
  }
  const layout = close(node)
  normalizeDashboardLayoutTopology(layout)
  return {
    layout,
    createdWidgets: {},
    removedIdentityIds: layout !== node && target ? [target.identityId] : [],
  }
}

export function applyLayoutEditDocument(
  current: DashboardLayoutDocumentContent,
  entityDocument: string,
  removedPanelIds: readonly string[] = []
): DashboardLayoutEditPlan {
  const normalizedCurrent = normalizeDashboardLayoutDocumentContent(current)
  let parsed: unknown
  try {
    parsed = JSON.parse(entityDocument)
  } catch {
    failDashboardLayout('entityDocument', 'entityDocument must be valid JSON')
  }
  if (!isRecord(parsed)) failDashboardLayout('entityDocument', 'entityDocument must be an object')

  const structure = DashboardLayoutStructureDocumentSchema.safeParse(parsed)
  if (!structure.success) {
    throw new DashboardLayoutValidationError(
      structure.error.issues.map((issue) => ({
        path: `entityDocument.${issue.path.join('.')}`,
        message: issue.message,
      }))
    )
  }

  const currentPanels = new Map<string, Extract<DashboardLayoutTopologyNode, { type: 'panel' }>>()
  const collect = (node: DashboardLayoutTopologyNode) => {
    if (node.type === 'panel') currentPanels.set(node.id, node)
    else node.children.forEach(collect)
  }
  collect(normalizedCurrent.layout)

  const removed = new Set(removedPanelIds.map((id) => id.trim()))
  if (removed.has('') || removed.size !== removedPanelIds.length) {
    failDashboardLayout('removedPanelIds', 'removedPanelIds must be unique non-empty panel ids')
  }
  for (const id of removed) {
    if (!currentPanels.has(id)) failDashboardLayout('removedPanelIds', `Unknown panel: ${id}`)
  }

  const retained = new Set<string>()
  const nodeIds = new Set<string>()
  const createdWidgets: DashboardWidgetsState = {}
  const replacedIdentityIds = new Set<string>()
  const materialize = (node: any): DashboardLayoutTopologyNode => {
    const id = node.id || createLayoutNodeId()
    if (nodeIds.has(id)) failDashboardLayout('entityDocument.layout.id', `Duplicate node: ${id}`)
    nodeIds.add(id)
    if (node.type === 'group') {
      return { ...node, id, children: node.children.map(materialize) }
    }
    if ('widget' in node) {
      const existing = node.id ? currentPanels.get(id) : null
      if (node.id && !existing) {
        failDashboardLayout('entityDocument.layout.id', `Unknown panel: ${id}`)
      }
      if (removed.has(id)) {
        failDashboardLayout('removedPanelIds', `Removed panel still appears in document: ${id}`)
      }
      const binding = planPanelWidgetBinding(existing ?? { id, type: 'panel' }, node.widget.key)
      Object.assign(createdWidgets, binding.createdWidgets)
      binding.removedIdentityIds.forEach((identityId) => replacedIdentityIds.add(identityId))
      if (existing) retained.add(id)
      return binding.panel
    }
    if (removed.has(id)) {
      failDashboardLayout('removedPanelIds', `Removed panel still appears in document: ${id}`)
    }
    const existing = currentPanels.get(id)
    if (!existing) failDashboardLayout('entityDocument.layout.id', `Unknown panel: ${id}`)
    retained.add(id)
    return { ...existing }
  }

  const layout = materialize(structure.data.layout)
  const omitted = [...currentPanels.keys()].filter((id) => !retained.has(id) && !removed.has(id))
  if (omitted.length > 0) {
    failDashboardLayout(
      'removedPanelIds',
      `Existing panels omitted without removedPanelIds: ${omitted.join(', ')}`
    )
  }
  const removedIdentityIds = new Set(replacedIdentityIds)
  for (const id of removed) {
    const identityId = currentPanels.get(id)?.identityId
    if (identityId) removedIdentityIds.add(identityId)
  }
  const widgets = { ...normalizedCurrent.widgets, ...createdWidgets }
  for (const identityId of removedIdentityIds) delete widgets[identityId]
  normalizeDashboardLayoutDocumentContent({
    layout,
    widgets,
    colorPairs: normalizedCurrent.colorPairs,
  })
  return { layout, createdWidgets, removedIdentityIds: [...removedIdentityIds] }
}
