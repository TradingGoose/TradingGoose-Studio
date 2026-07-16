import { isEqual } from 'lodash'
import { z } from 'zod'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import type { PairColorContext } from '@/widgets/color-pairs'
import { normalizePairColorContext } from '@/widgets/color-pairs'
import {
  createDefaultColorPairsState,
  createDefaultLayoutState,
  createLayoutNodeId,
  type LayoutNode,
  type LinkedPairColor,
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

export const DASHBOARD_LAYOUT_DOCUMENT_FORMAT = 'tg-dashboard-layout-document-v3' as const
export const DASHBOARD_LAYOUT_STRUCTURE_DOCUMENT_FORMAT =
  'tg-dashboard-layout-structure-v3' as const

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

export type DashboardLayoutDocument = {
  layout: DashboardLayoutTopologyNode
}

/** Read-time projection composed from independent layout, widget, and pair owners. */
export type DashboardLayoutProjectionContent = DashboardLayoutDocument & {
  widgets: DashboardWidgetsState
  colorPairs: PersistedColorPairsState
}

export type DashboardWidgetBindingCreation = {
  identityId: string
  widgetKey: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey']
  sourceIdentityId?: string
}

export type DashboardLayoutEditPlan = {
  layout: DashboardLayoutTopologyNode
  createdBindings: DashboardWidgetBindingCreation[]
  removedIdentityIds: string[]
}

export type DashboardLayoutStructureMutation =
  | { type: 'split'; panelId: string; direction: 'horizontal' | 'vertical' }
  | { type: 'close'; panelId: string }
  | { type: 'replace'; panelId: string; widgetKey: string }
  | { type: 'resize'; groupId: string; sizes: number[] }

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

const DashboardGroupSizesSchema = z
  .array(z.number().finite().nonnegative())
  .refine((sizes) => sizes.some((size) => size > 0), 'sizes must contain a positive size')

const DashboardLayoutGroupNodeSchema: z.ZodTypeAny = z
  .object({
    id: z.string().trim().min(1),
    type: z.literal('group'),
    direction: z.enum(['horizontal', 'vertical']),
    sizes: DashboardGroupSizesSchema,
    children: z.array(DashboardLayoutNodeSchema).min(1),
  })
  .strict()
  .refine((node) => node.sizes.length === node.children.length, {
    path: ['sizes'],
    message: 'sizes must contain one nonnegative size per child',
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
        sizes: DashboardGroupSizesSchema,
        children: z.array(DashboardLayoutStructureNodeSchema).min(1),
      })
      .strict()
      .refine((node) => node.sizes.length === node.children.length, {
        path: ['sizes'],
        message: 'sizes must contain one nonnegative size per child',
      }),
  ])
)

export const DashboardLayoutStructureDocumentSchema = z
  .object({ layout: DashboardLayoutStructureNodeSchema })
  .strict()

export const DashboardLayoutDocumentSchema = z
  .object({ layout: DashboardLayoutNodeSchema })
  .strict()

export const DashboardWidgetDocumentSchema = z
  .object({
    pairColor: PairColorSchema,
    params: z.record(z.unknown()).nullable(),
  })
  .strict()

const DashboardWidgetsSchema = z.record(DashboardWidgetDocumentSchema)
const DashboardColorPairsSchema = z
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

/** Complete read-time projection. It is never persisted or connected as one Yjs document. */
export const DashboardLayoutProjectionSchema = z
  .object({
    layout: DashboardLayoutNodeSchema,
    widgets: DashboardWidgetsSchema,
    colorPairs: DashboardColorPairsSchema,
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

export function collectDashboardTopologyReferences(
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
  return { layout: normalized, references: collectDashboardTopologyReferences(normalized) }
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

export function createDefaultDashboardLayoutProjection(): DashboardLayoutProjectionContent {
  const widgets: DashboardWidgetsState = {}
  return {
    layout: defaultTopology(createDefaultLayoutState(), widgets),
    widgets,
    colorPairs: createDefaultColorPairsState(),
  }
}

export function createDefaultDashboardWidgetDocument(
  widgetKey: DashboardPanelTopologyNode['widgetKey']
): DashboardWidgetDocument {
  if (!widgetKey) return { pairColor: 'gray', params: null }
  const widget = getDefaultWidgetInstance(widgetKey)
  return { pairColor: widget.pairColor ?? 'gray', params: widget.params ?? null }
}

export function normalizeDashboardLayoutDocument(value: unknown): DashboardLayoutDocument {
  const parsed = DashboardLayoutDocumentSchema.safeParse(value)
  if (!parsed.success) throw zodValidationError(parsed.error)
  return { layout: normalizeDashboardLayoutTopology(parsed.data.layout) }
}

export function normalizeDashboardLayoutTopology(layout: unknown): DashboardLayoutTopologyNode {
  return normalizeTopologyWithReferences(layout).layout
}

export function normalizeDashboardWidgetDocument(
  widgetKey: DashboardPanelTopologyNode['widgetKey'],
  value: unknown
): DashboardWidgetDocument {
  const parsed = normalizeDashboardWidgetStorageDocument(value)
  if (widgetKey === null) {
    if (parsed.pairColor !== 'gray' || parsed.params !== null) {
      failDashboardLayout(
        'widget',
        'A null-key dashboard widget must equal { pairColor: "gray", params: null }'
      )
    }
    return { pairColor: 'gray', params: null }
  }
  let sanitized
  try {
    sanitized = sanitizeWidgetInstance({ key: widgetKey, ...parsed }, { strict: true })
  } catch (error) {
    if (isWidgetContractValidationError(error)) {
      throw new DashboardLayoutValidationError(
        error.issues.map((issue) => ({
          path: joinValidationPath('widget', issue.path.split('.')),
          message: issue.message,
        }))
      )
    }
    failDashboardLayout('widget', error instanceof Error ? error.message : 'Widget is invalid')
  }
  if (!sanitized) failDashboardLayout('widget', `Dashboard widget ${widgetKey} is invalid`)
  const params = sanitized.params ?? null
  if (!isEqual(parsed.params, params)) {
    failDashboardLayout('widget.params', `Dashboard widget ${widgetKey}.params must be canonical`)
  }
  return { pairColor: sanitized.pairColor ?? 'gray', params }
}

export function normalizeDashboardWidgetStorageDocument(value: unknown): DashboardWidgetDocument {
  const parsed = DashboardWidgetDocumentSchema.safeParse(value)
  if (!parsed.success) throw zodValidationError(parsed.error, 'widget')
  return parsed.data as DashboardWidgetDocument
}

export function normalizeDashboardColorPairDocument(value: unknown): PairColorContext {
  if (!isRecord(value)) failDashboardLayout('colorPair', 'Color-pair context must be an object')
  const normalized = normalizePairColorContext(value)
  if (!isEqual(value, normalized)) {
    failDashboardLayout('colorPair', 'Color-pair context must contain only canonical shared fields')
  }
  return normalized
}

export function normalizeDashboardLayoutProjection(
  value: unknown
): DashboardLayoutProjectionContent {
  if (!isRecord(value)) failDashboardLayout('document', 'Dashboard projection must be an object')
  const document = normalizeDashboardLayoutDocument({ layout: value.layout })
  const references = collectDashboardTopologyReferences(document.layout)
  if (!isRecord(value.widgets)) failDashboardLayout('widgets', 'widgets must be an object')
  const widgets: DashboardWidgetsState = {}
  for (const [identityId, widgetKey] of references) {
    if (!Object.hasOwn(value.widgets, identityId)) {
      failDashboardLayout(`widgets.${identityId}`, `Dashboard widget ${identityId} is missing`)
    }
    widgets[identityId] = normalizeDashboardWidgetDocument(
      widgetKey,
      (value.widgets as Record<string, unknown>)[identityId]
    )
  }
  return {
    ...document,
    widgets,
    colorPairs: normalizeColorPairsState(value.colorPairs),
  }
}

export function serializeDashboardLayoutProjection(
  content: DashboardLayoutProjectionContent
): string {
  return JSON.stringify(normalizeDashboardLayoutProjection(content), null, 2)
}

export function resolveDashboardLayout(
  layout: DashboardLayoutTopologyNode,
  widgets: DashboardWidgetsState
): LayoutNode {
  const normalized = normalizeDashboardLayoutTopology(layout)
  const resolve = (node: DashboardLayoutTopologyNode): LayoutNode => {
    if (node.type === 'panel') {
      const widget = widgets[node.identityId]
      if (!widget) {
        failDashboardLayout(
          `widgets.${node.identityId}`,
          `Dashboard widget ${node.identityId} is missing`
        )
      }
      return {
        id: node.id,
        type: 'panel',
        widget: node.widgetKey ? { key: node.widgetKey, ...widget } : null,
      }
    }
    return { ...node, children: node.children.map(resolve) }
  }
  return resolve(normalized)
}

export function findDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panelId: string
): DashboardPanelTopologyNode | null {
  if (node.type === 'panel') return node.id === panelId ? node : null
  for (const child of node.children) {
    const found = findDashboardTopologyPanel(child, panelId)
    if (found) return found
  }
  return null
}

export function countDashboardTopologyPanels(node: DashboardLayoutTopologyNode): number {
  return node.type === 'panel'
    ? 1
    : node.children.reduce((count, child) => count + countDashboardTopologyPanels(child), 0)
}

function planPanelWidgetBinding(
  panel: DashboardPanelTopologyNode | Pick<DashboardPanelTopologyNode, 'id' | 'type'>,
  widgetKey: string
): {
  panel: DashboardPanelTopologyNode
  createdBindings: DashboardWidgetBindingCreation[]
  removedIdentityIds: string[]
} {
  if (!isWidgetKey(widgetKey))
    failDashboardLayout('widget.key', `Unknown widget key "${widgetKey}"`)
  const current = 'identityId' in panel ? panel : null
  if (current?.widgetKey === widgetKey) {
    return { panel: current, createdBindings: [], removedIdentityIds: [] }
  }
  const identityId = createLayoutNodeId()
  return {
    panel: { ...panel, identityId, widgetKey },
    createdBindings: [{ identityId, widgetKey }],
    removedIdentityIds: current ? [current.identityId] : [],
  }
}

function replaceTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panel: DashboardPanelTopologyNode
): DashboardLayoutTopologyNode {
  if (node.type === 'panel') return node.id === panel.id ? panel : node
  const children = node.children.map((child) => replaceTopologyPanel(child, panel))
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node
}

export function replaceDashboardPanelWidget(
  layout: DashboardLayoutTopologyNode,
  panelId: string,
  widgetKey: string
): DashboardLayoutEditPlan {
  const panel = findDashboardTopologyPanel(layout, panelId)
  if (!panel) failDashboardLayout('panelId', `Unknown panel: ${panelId}`)
  const binding = planPanelWidgetBinding(panel, widgetKey)
  const next = replaceTopologyPanel(layout, binding.panel)
  normalizeDashboardLayoutTopology(next)
  return {
    layout: next,
    createdBindings: binding.createdBindings,
    removedIdentityIds: binding.removedIdentityIds,
  }
}

function updateDashboardTopologyGroupSizes(
  node: DashboardLayoutTopologyNode,
  groupId: string,
  sizes: number[],
  found: { value: boolean }
): DashboardLayoutTopologyNode {
  if (node.type === 'panel') return node
  if (node.id === groupId) {
    found.value = true
    return isEqual(node.sizes, sizes) ? node : { ...node, sizes: [...sizes] }
  }
  const children = node.children.map((child) =>
    updateDashboardTopologyGroupSizes(child, groupId, sizes, found)
  )
  return children.some((child, index) => child !== node.children[index])
    ? { ...node, children }
    : node
}

export function splitDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panelId: string,
  direction: 'horizontal' | 'vertical'
): DashboardLayoutEditPlan {
  normalizeDashboardLayoutTopology(node)
  const createdBindings: DashboardWidgetBindingCreation[] = []
  const split = (current: DashboardLayoutTopologyNode): DashboardLayoutTopologyNode => {
    if (current.type === 'group') {
      const children = current.children.map(split)
      return children.some((child, index) => child !== current.children[index])
        ? { ...current, children }
        : current
    }
    if (current.id !== panelId) return current
    const identityId = createLayoutNodeId()
    createdBindings.push({
      identityId,
      widgetKey: current.widgetKey,
      sourceIdentityId: current.identityId,
    })
    return {
      id: createLayoutNodeId(),
      type: 'group',
      direction,
      sizes: [50, 50],
      children: [
        { ...current, id: createLayoutNodeId() },
        { ...current, id: createLayoutNodeId(), identityId },
      ],
    }
  }
  const layout = split(node)
  if (createdBindings.length === 0) failDashboardLayout('panelId', `Unknown panel: ${panelId}`)
  normalizeDashboardLayoutTopology(layout)
  return { layout, createdBindings, removedIdentityIds: [] }
}

export function closeDashboardTopologyPanel(
  node: DashboardLayoutTopologyNode,
  panelId: string
): DashboardLayoutEditPlan {
  normalizeDashboardLayoutTopology(node)
  const target = findDashboardTopologyPanel(node, panelId)
  if (!target) failDashboardLayout('panelId', `Unknown panel: ${panelId}`)
  if (node.type === 'panel' && node.id === panelId) {
    failDashboardLayout('panelId', `Cannot close panel: ${panelId}`)
  }
  const close = (current: DashboardLayoutTopologyNode): DashboardLayoutTopologyNode => {
    if (current.type === 'panel') return current
    const index = current.children.findIndex(
      (child) => child.type === 'panel' && child.id === panelId
    )
    if (index >= 0) {
      const children = current.children.filter((_, childIndex) => childIndex !== index)
      if (children.length === 0) failDashboardLayout('panelId', `Cannot close panel: ${panelId}`)
      if (children.length === 1) return { ...children[0], id: createLayoutNodeId() }
      const remainingSizes = current.sizes.filter((_, childIndex) => childIndex !== index)
      const total = remainingSizes.reduce((sum, size) => sum + size, 0)
      return {
        ...current,
        id: createLayoutNodeId(),
        children,
        sizes: remainingSizes.map((size) =>
          total > 0 ? (size / total) * 100 : 100 / children.length
        ),
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
    createdBindings: [],
    removedIdentityIds: [target.identityId],
  }
}

export function applyDashboardLayoutStructureMutation(
  layout: DashboardLayoutTopologyNode,
  mutation: DashboardLayoutStructureMutation
): DashboardLayoutEditPlan {
  switch (mutation.type) {
    case 'split':
      return splitDashboardTopologyPanel(layout, mutation.panelId, mutation.direction)
    case 'close':
      return closeDashboardTopologyPanel(layout, mutation.panelId)
    case 'replace':
      return replaceDashboardPanelWidget(layout, mutation.panelId, mutation.widgetKey)
    case 'resize': {
      const found = { value: false }
      const next = updateDashboardTopologyGroupSizes(
        layout,
        mutation.groupId,
        mutation.sizes,
        found
      )
      if (!found.value) failDashboardLayout('groupId', `Unknown group: ${mutation.groupId}`)
      normalizeDashboardLayoutTopology(next)
      return { layout: next, createdBindings: [], removedIdentityIds: [] }
    }
  }
}

export function planDashboardLayoutDocumentReplacement(
  current: DashboardLayoutDocument,
  next: DashboardLayoutDocument
): DashboardLayoutEditPlan {
  const currentDocument = normalizeDashboardLayoutDocument(current)
  const nextDocument = normalizeDashboardLayoutDocument(next)
  const currentReferences = collectDashboardTopologyReferences(currentDocument.layout)
  const nextReferences = collectDashboardTopologyReferences(nextDocument.layout)
  const createdBindings: DashboardWidgetBindingCreation[] = []

  for (const [identityId, widgetKey] of nextReferences) {
    if (!currentReferences.has(identityId)) {
      createdBindings.push({ identityId, widgetKey })
      continue
    }
    if (currentReferences.get(identityId) !== widgetKey) {
      failDashboardLayout(
        'layout',
        `Dashboard widget ${identityId} cannot change widgetKey without a new identityId`
      )
    }
  }

  return {
    layout: nextDocument.layout,
    createdBindings,
    removedIdentityIds: [...currentReferences.keys()].filter(
      (identityId) => !nextReferences.has(identityId)
    ),
  }
}

export function applyLayoutEditDocument(
  current: DashboardLayoutDocument,
  entityDocument: string,
  removedPanelIds: readonly string[] = []
): DashboardLayoutEditPlan {
  const normalizedCurrent = normalizeDashboardLayoutDocument(current)
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
  const currentPanels = new Map<string, DashboardPanelTopologyNode>()
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
  const createdBindings: DashboardWidgetBindingCreation[] = []
  const replacedIdentityIds = new Set<string>()
  const materialize = (node: any): DashboardLayoutTopologyNode => {
    const id = node.id || createLayoutNodeId()
    if (nodeIds.has(id)) failDashboardLayout('entityDocument.layout.id', `Duplicate node: ${id}`)
    nodeIds.add(id)
    if (node.type === 'group') return { ...node, id, children: node.children.map(materialize) }
    if ('widget' in node) {
      const existing = node.id ? currentPanels.get(id) : null
      if (node.id && !existing)
        failDashboardLayout('entityDocument.layout.id', `Unknown panel: ${id}`)
      if (removed.has(id)) {
        failDashboardLayout('removedPanelIds', `Removed panel still appears in document: ${id}`)
      }
      const binding = planPanelWidgetBinding(existing ?? { id, type: 'panel' }, node.widget.key)
      createdBindings.push(...binding.createdBindings)
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
  normalizeDashboardLayoutTopology(layout)
  return { layout, createdBindings, removedIdentityIds: [...removedIdentityIds] }
}
