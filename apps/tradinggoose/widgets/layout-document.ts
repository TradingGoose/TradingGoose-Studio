import { z } from 'zod'
import { ListingIdentitySchema, toListingValueObject } from '@/lib/listing/identity'
import {
  type LinkedPairColor,
  normalizePairColorContext,
  type PersistedColorPair,
} from '@/widgets/color-pairs'
import {
  type LayoutNode,
  normalizeColorPairsState,
  normalizeDashboardLayout,
  type PersistedColorPairsState,
  type WidgetInstance,
} from '@/widgets/layout'
import { isPairColor, PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'
import {
  isWidgetKey,
  resolveEffectiveWidgetParams,
  sanitizeWidgetInstance as sanitizeContractWidgetInstance,
} from '@/widgets/widget-contracts'

export const DASHBOARD_LAYOUT_DOCUMENT_FORMAT = 'tg-dashboard-layout-document-v1' as const

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

const PersistedWidgetKeySchema = z.string().trim().min(1)
const PairColorSchema = z.enum(PAIR_COLORS as [PairColor, ...PairColor[]])
const LinkedPairColorSchema = z.enum(
  PAIR_COLORS.filter((color): color is LinkedPairColor => color !== 'gray') as [
    LinkedPairColor,
    ...LinkedPairColor[],
  ]
)

const DashboardLayoutWidgetInstanceSchema = z
  .object({
    key: PersistedWidgetKeySchema,
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
    return { key, pairColor: widget.pairColor, params }
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
  entityDocument: string
): DashboardLayoutDocumentFields {
  let parsed: unknown
  try {
    parsed = JSON.parse(entityDocument)
  } catch {
    failDashboardLayout('entityDocument', 'entityDocument must be valid JSON')
  }
  if (!isRecord(parsed))
    failDashboardLayout('entityDocument', 'entityDocument must be a JSON object')

  const nextFields = normalizeDashboardLayoutDocumentFields(parsed)
  return {
    ...nextFields,
    isActive: currentFields.isActive || nextFields.isActive,
  }
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
        ? {
            ...canonicalPair,
            listing: rawPair.listing as PersistedColorPair['listing'],
          }
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
  if (!isWidgetKey(widget.key)) return widget

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
