import { z } from 'zod'
import { ListingIdentitySchema } from '@/lib/listing/identity'
import type { LinkedPairColor } from '@/widgets/color-pairs'
import {
  createLayoutNodeId,
  type LayoutNode,
  normalizeColorPairsState,
  type PersistedColorPairsState,
  type WidgetInstance,
} from '@/widgets/layout'
import { isPairColor, PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import {
  getDefaultWidgetInstance,
  isWidgetKey,
  pruneDashboardColorPairsForLayout,
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
    pairColor: PairColorSchema,
    params: z.record(z.unknown()).nullable(),
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

const DashboardLayoutStructureNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z
      .object({
        id: z.string().trim().min(1),
        type: z.literal('panel'),
      })
      .strict(),
    z
      .object({
        type: z.literal('panel'),
        widget: z
          .object({
            key: WidgetKeySchema,
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        id: z.string().trim().min(1).optional(),
        type: z.literal('group'),
        direction: z.enum(['horizontal', 'vertical']),
        sizes: z.array(z.number().finite().positive()),
        children: z.array(DashboardLayoutStructureNodeSchema).min(1),
      })
      .strict(),
  ])
)

export const DashboardLayoutStructureDocumentSchema = z
  .object({
    layout: DashboardLayoutStructureNodeSchema,
    name: z.string().trim().min(1).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.literal(true).optional(),
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
    return {
      id,
      type: 'panel',
      widget: normalizeDocumentWidget(layout.widget, `${path}.widget`),
    }
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
  if (!isPairColor(widget.pairColor))
    throw new Error(`${path}.pairColor must be a valid pair color`)
  if (!Object.hasOwn(widget, 'params')) throw new Error(`${path}.params is required`)
  const params = widget.params ?? null
  if (params !== null && !isRecord(params)) {
    throw new Error(`${path}.params must be an object or null`)
  }
  if (!isWidgetKey(key)) {
    throw new Error(`${path}.key must be a canonical widget key`)
  }

  return sanitizeContractWidgetInstance(
    { key, pairColor: widget.pairColor, params },
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

  const parsedStructure = DashboardLayoutStructureDocumentSchema.safeParse(parsed)
  if (!parsedStructure.success) {
    throw new DashboardLayoutValidationError(
      parsedStructure.error.issues.map((issue) => {
        let path = 'entityDocument'
        for (const segment of issue.path) {
          path = typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`
        }
        return { path, message: issue.message }
      })
    )
  }

  const currentPanelWidgets = new Map<string, WidgetInstance>()
  const collectPanelWidgets = (node: LayoutNode) => {
    if (node.type === 'panel') {
      currentPanelWidgets.set(node.id, node.widget)
      return
    }
    node.children.forEach(collectPanelWidgets)
  }
  collectPanelWidgets(currentFields.layout)

  const removedPanels = new Set(removedPanelIds.map((id) => id.trim()))
  if (removedPanels.has('') || removedPanels.size !== removedPanelIds.length) {
    failDashboardLayout('removedPanelIds', 'removedPanelIds must be unique non-empty panel ids')
  }
  for (const id of removedPanels) {
    if (!currentPanelWidgets.has(id)) {
      failDashboardLayout('removedPanelIds', `Unknown removedPanelIds entry: ${id}`)
    }
  }

  const retainedPanelIds = new Set<string>()
  const seenIds = new Set<string>()
  const materializeStructureNode = (node: any): LayoutNode => {
    const id = 'id' in node && node.id ? node.id : createLayoutNodeId()
    if (seenIds.has(id)) {
      failDashboardLayout('entityDocument.layout.id', `Duplicate layout node id: ${id}`)
    }
    seenIds.add(id)

    if (node.type === 'panel') {
      if ('widget' in node) {
        return { id, type: 'panel', widget: getDefaultWidgetInstance(node.widget.key) }
      }
      if (removedPanels.has(id)) {
        failDashboardLayout(
          'removedPanelIds',
          `removedPanelIds still appear in edit_layout entityDocument: ${id}`
        )
      }
      if (!currentPanelWidgets.has(id)) {
        failDashboardLayout('entityDocument.layout.id', `Unknown existing panel id: ${id}`)
      }
      retainedPanelIds.add(id)
      return {
        id,
        type: 'panel',
        widget: currentPanelWidgets.get(id) ?? null,
      }
    }

    const children = node.children.map(materializeStructureNode)
    return {
      id,
      type: 'group',
      direction: node.direction,
      sizes: readCanonicalGroupSizes(node.sizes, children.length, 'entityDocument.layout.sizes'),
      children,
    }
  }

  const structureDocument = parsedStructure.data
  const nextLayout = materializeStructureNode(structureDocument.layout)
  const omittedPanelIds = [...currentPanelWidgets.keys()].filter(
    (panelId) => !retainedPanelIds.has(panelId) && !removedPanels.has(panelId)
  )
  if (omittedPanelIds.length > 0) {
    failDashboardLayout(
      'removedPanelIds',
      `Existing panel ids omitted from edit_layout entityDocument without removedPanelIds: ${omittedPanelIds.join(', ')}`
    )
  }

  return normalizeDashboardLayoutDocumentFields({
    ...currentFields,
    name: structureDocument.name ?? currentFields.name,
    sortOrder: structureDocument.sortOrder ?? currentFields.sortOrder,
    isActive: currentFields.isActive || structureDocument.isActive === true,
    layout: nextLayout,
    colorPairs: pruneDashboardColorPairsForLayout(nextLayout, currentFields.colorPairs),
  })
}
