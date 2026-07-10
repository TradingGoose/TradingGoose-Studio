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
  isWidgetKey,
  sanitizeWidgetInstance,
  WIDGET_KEYS,
} from '@/widgets/widget-contracts'

export const DASHBOARD_LAYOUT_DOCUMENT_FORMAT = 'tg-dashboard-layout-document-v2' as const
export const DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT =
  'tg-dashboard-layout-structure-v2' as const
export const DASHBOARD_WIDGET_DOCUMENT_FORMAT = 'tg-dashboard-widget-document-v1' as const

export type DashboardWidgetDocument = {
  pairColor: PairColor
  params: Record<string, unknown> | null
}

export type DashboardWidgetsState = Record<string, DashboardWidgetDocument>

export type DashboardLayoutTopologyNode =
  | {
      id: string
      type: 'panel'
      identityId: string | null
      widgetKey: (typeof WIDGET_KEYS)[number] | null
    }
  | {
      id: string
      type: 'group'
      direction: 'horizontal' | 'vertical'
      sizes: number[]
      children: DashboardLayoutTopologyNode[]
    }

export type PersistedDashboardLayoutContent = {
  layout: DashboardLayoutTopologyNode
  widgets: DashboardWidgetsState
}

export type DashboardLayoutDocumentContent = PersistedDashboardLayoutContent & {
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
    identityId: z.string().trim().min(1).nullable(),
    widgetKey: WidgetKeySchema.nullable(),
  })
  .strict()
  .refine((node) => (node.identityId === null) === (node.widgetKey === null), {
    message: 'identityId and widgetKey must both be null or both be set',
  })

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

function defaultTopology(node: LayoutNode): DashboardLayoutTopologyNode {
  if (node.type === 'panel') {
    return { id: node.id, type: 'panel', identityId: null, widgetKey: null }
  }
  return { ...node, children: node.children.map(defaultTopology) }
}

export function createDefaultDashboardLayoutContent(): DashboardLayoutDocumentContent {
  return {
    layout: defaultTopology(createDefaultLayoutState()),
    widgets: {},
    colorPairs: createDefaultColorPairsState(),
  }
}

export function resolveDashboardLayout(
  layout: DashboardLayoutTopologyNode,
  widgets: DashboardWidgetsState
): LayoutNode {
  if (layout.type === 'panel') {
    const widget = layout.identityId ? widgets[layout.identityId] : null
    return {
      id: layout.id,
      type: 'panel',
      widget:
        widget && layout.widgetKey
          ? { key: layout.widgetKey, pairColor: widget.pairColor, params: widget.params }
          : null,
    }
  }
  return {
    ...layout,
    children: layout.children.map((child) => resolveDashboardLayout(child, widgets)),
  }
}

export function normalizeDashboardLayoutDocumentContent(
  fields: unknown
): DashboardLayoutDocumentContent {
  const parsed = DashboardLayoutDocumentContentSchema.parse(
    fields
  ) as DashboardLayoutDocumentContent
  const widgets = normalizeDocumentWidgets(parsed.layout, parsed.widgets)
  return {
    layout: parsed.layout,
    widgets,
    colorPairs: normalizeColorPairsState(parsed.colorPairs),
  }
}

export function normalizeDashboardLayoutTopology(layout: unknown): DashboardLayoutTopologyNode {
  return DashboardLayoutNodeSchema.parse(layout) as DashboardLayoutTopologyNode
}

export function normalizeDashboardWidgetDocument(
  widgetKey: (typeof WIDGET_KEYS)[number],
  value: unknown
): DashboardWidgetDocument {
  const widget = DashboardWidgetDocumentSchema.parse(value)
  const sanitized = sanitizeWidgetInstance({ key: widgetKey, ...widget }, { strict: true })
  if (!sanitized) throw new Error(`dashboard widget ${widgetKey} is invalid`)
  const params = sanitized.params ?? null
  if (!isEqual(widget.params, params)) {
    throw new Error(`dashboard widget ${widgetKey}.params must be canonical`)
  }
  return { pairColor: sanitized.pairColor ?? 'gray', params }
}

function normalizeDocumentWidgets(
  layout: DashboardLayoutTopologyNode,
  widgets: DashboardWidgetsState
): DashboardWidgetsState {
  const references = new Map<string, (typeof WIDGET_KEYS)[number]>()
  const nodeIds = new Set<string>()
  const visit = (node: DashboardLayoutTopologyNode) => {
    if (nodeIds.has(node.id)) throw new Error(`dashboard layout contains duplicate node ${node.id}`)
    nodeIds.add(node.id)
    if (node.type === 'group') {
      node.children.forEach(visit)
      return
    }
    if (!node.identityId || !node.widgetKey) return
    if (references.has(node.identityId)) {
      throw new Error(`dashboard layout widget ${node.identityId} is referenced by multiple panels`)
    }
    references.set(node.identityId, node.widgetKey)
  }
  visit(layout)

  const normalized: DashboardWidgetsState = {}
  for (const [identityId, widgetKey] of references) {
    const widget = widgets[identityId]
    if (!widget) throw new Error(`dashboard layout references missing widget ${identityId}`)
    normalized[identityId] = normalizeDashboardWidgetDocument(widgetKey, widget)
  }
  const orphan = Object.keys(widgets).find((identityId) => !references.has(identityId))
  if (orphan) throw new Error(`dashboard layout contains orphan widget ${orphan}`)
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
  panel: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>,
  widgetKey: string
): {
  panel: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>
  createdWidgets: DashboardWidgetsState
  removedIdentityIds: string[]
} {
  if (!isWidgetKey(widgetKey)) {
    failDashboardLayout('widget.key', `Unknown widget key "${widgetKey}"`)
  }
  if (panel.identityId && panel.widgetKey === widgetKey) {
    return { panel, createdWidgets: {}, removedIdentityIds: [] }
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
    removedIdentityIds: panel.identityId ? [panel.identityId] : [],
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
  const createdWidgets: DashboardWidgetsState = {}
  const split = (current: DashboardLayoutTopologyNode): DashboardLayoutTopologyNode => {
    if (current.type === 'group') {
      const children = current.children.map(split)
      return children.some((child, index) => child !== current.children[index])
        ? { ...current, children }
        : current
    }
    if (current.id !== panelId) return current

    const cloneIdentityId = current.identityId ? createLayoutNodeId() : null
    if (cloneIdentityId && current.identityId) {
      const source = widgets[current.identityId]
      if (!source)
        throw new Error(`dashboard layout references missing widget ${current.identityId}`)
      createdWidgets[cloneIdentityId] = { ...source }
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

  return { layout: split(node), createdWidgets, removedIdentityIds: [] }
}

export function closeDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panelId: string
): DashboardLayoutEditPlan {
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
  return {
    layout,
    createdWidgets: {},
    removedIdentityIds: layout !== node && target?.identityId ? [target.identityId] : [],
  }
}

export function applyLayoutEditDocument(
  current: DashboardLayoutDocumentContent,
  entityDocument: string,
  removedPanelIds: readonly string[] = []
): DashboardLayoutEditPlan {
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
  collect(current.layout)

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
      const binding = planPanelWidgetBinding(
        existing ?? { id, type: 'panel', identityId: null, widgetKey: null },
        node.widget.key
      )
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
  const widgets = { ...current.widgets, ...createdWidgets }
  for (const identityId of removedIdentityIds) delete widgets[identityId]
  normalizeDashboardLayoutDocumentContent({ layout, widgets, colorPairs: current.colorPairs })
  return { layout, createdWidgets, removedIdentityIds: [...removedIdentityIds] }
}
