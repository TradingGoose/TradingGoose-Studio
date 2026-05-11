import { REVIEW_ENTITY_KINDS, type ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { normalizeOptionalString } from '@/lib/utils'
import type { PairColor } from '@/widgets/pair-colors'
import { isPairColor } from '@/widgets/pair-colors'

export type WidgetInstance = {
  key: string
  pairColor?: PairColor
  params?: Record<string, unknown> | null
} | null

export type LinkedPairColor = Exclude<PairColor, 'gray'>

export type PersistedColorPair = {
  color: LinkedPairColor
  workflowId?: string | null
  listing?: ListingIdentity | null
  indicatorId?: string | null
  mcpServerId?: string | null
  customToolId?: string | null
  skillId?: string | null
  reviewSessionId?: string | null
  reviewEntityKind?: ReviewEntityKind | null
  reviewEntityId?: string | null
  reviewDraftSessionId?: string | null
}

export type PersistedColorPairsState = {
  pairs: PersistedColorPair[]
}

export type LayoutNode =
  | {
      id: string
      type: 'panel'
      widget: WidgetInstance
    }
  | {
      id: string
      type: 'group'
      direction: 'horizontal' | 'vertical'
      sizes: number[]
      children: LayoutNode[]
    }

export type PersistedLayoutNode =
  | {
      id?: string
      type: 'panel'
      widget: WidgetInstance
    }
  | {
      id?: string
      type: 'group'
      direction: 'horizontal' | 'vertical'
      sizes: number[]
      children: PersistedLayoutNode[]
    }

const randomHexString = (length = 32) => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(Math.ceil(length / 2))
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, length)
  }

  let result = ''
  for (let i = 0; i < length; i += 1) {
    result += Math.floor(Math.random() * 16).toString(16)
  }
  return result
}

export const createLayoutNodeId = () => randomHexString(32)

export const createDefaultColorPairsState = (): PersistedColorPairsState => ({
  pairs: [],
})

export function resolveWidgetParamsForPairColorChange(
  widget: WidgetInstance,
  nextColor: PairColor
): Record<string, unknown> | null {
  const currentParams = widget?.params ?? null
  if (nextColor === 'gray') {
    return currentParams
  }

  // Data-provider configuration stays widget-local even when listing selection is linked.
  if (widget?.key === 'data_chart' || widget?.key === 'heatmap') {
    return currentParams
  }

  return null
}

const normalizeListingIdentity = (value: unknown): ListingIdentity | null => {
  if (!value || typeof value !== 'object') return null
  const listing = toListingValueObject(value as any)
  if (!listing) return null
  return listing
}

const normalizeListingParamsForStorage = (
  params?: Record<string, unknown> | null
): Record<string, unknown> | null | undefined => {
  if (!params || typeof params !== 'object') return params
  if (!('listing' in params)) return params
  const listing = normalizeListingIdentity((params as { listing?: unknown }).listing)
  return { ...params, listing }
}

export function normalizeColorPairsState(state?: unknown): PersistedColorPairsState {
  if (!state || typeof state !== 'object') {
    return createDefaultColorPairsState()
  }

  const rawPairs = Array.isArray((state as { pairs?: unknown }).pairs)
    ? ((state as { pairs?: unknown }).pairs as unknown[])
    : []

  const seen = new Set<LinkedPairColor>()
  const normalized: PersistedColorPair[] = []

  for (const raw of rawPairs) {
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const rawColor = (raw as { color?: unknown }).color
    if (!isPairColor(rawColor) || rawColor === 'gray') {
      continue
    }

    if (seen.has(rawColor)) {
      continue
    }

    const workflowId = normalizeOptionalString((raw as { workflowId?: unknown }).workflowId)
    const listing = normalizeListingIdentity((raw as { listing?: unknown }).listing)
    const indicatorId = normalizeOptionalString((raw as { indicatorId?: unknown }).indicatorId)
    const mcpServerId = normalizeOptionalString((raw as { mcpServerId?: unknown }).mcpServerId)
    const customToolId = normalizeOptionalString((raw as { customToolId?: unknown }).customToolId)
    const skillId = normalizeOptionalString((raw as { skillId?: unknown }).skillId)
    const reviewSessionId = normalizeOptionalString(
      (raw as { reviewSessionId?: unknown }).reviewSessionId
    )
    const rawReviewEntityKind = normalizeOptionalString(
      (raw as { reviewEntityKind?: unknown }).reviewEntityKind
    )
    const validReviewEntityKind =
      rawReviewEntityKind && REVIEW_ENTITY_KINDS.includes(rawReviewEntityKind as ReviewEntityKind)
        ? (rawReviewEntityKind as ReviewEntityKind)
        : undefined
    const reviewEntityId = normalizeOptionalString(
      (raw as { reviewEntityId?: unknown }).reviewEntityId
    )
    const reviewDraftSessionId = normalizeOptionalString(
      (raw as { reviewDraftSessionId?: unknown }).reviewDraftSessionId
    )

    normalized.push({
      color: rawColor,
      workflowId,
      listing,
      indicatorId,
      mcpServerId,
      customToolId,
      skillId,
      reviewSessionId: validReviewEntityKind ? reviewSessionId : undefined,
      reviewEntityKind: validReviewEntityKind,
      reviewEntityId: validReviewEntityKind ? reviewEntityId : undefined,
      reviewDraftSessionId: validReviewEntityKind ? reviewDraftSessionId : undefined,
    })
    seen.add(rawColor)
  }

  return { pairs: normalized }
}

export function createDefaultLayoutState(): LayoutNode {
  return {
    id: createLayoutNodeId(),
    type: 'group',
    direction: 'horizontal',
    sizes: [20, 55, 25],
    children: [
      {
        id: createLayoutNodeId(),
        type: 'panel',
        widget: { key: 'empty', pairColor: 'gray', params: null },
      },
      {
        id: createLayoutNodeId(),
        type: 'group',
        direction: 'vertical',
        sizes: [70, 30],
        children: [
          {
            id: createLayoutNodeId(),
            type: 'panel',
            widget: { key: 'empty', pairColor: 'gray', params: { workflowId: 'default' } },
          },
          {
            id: createLayoutNodeId(),
            type: 'panel',
            widget: { key: 'empty', pairColor: 'gray', params: null },
          },
        ],
      },
      {
        id: createLayoutNodeId(),
        type: 'panel',
        widget: { key: 'empty', pairColor: 'gray', params: null },
      },
    ],
  }
}

export const DEFAULT_LAYOUT_STATE = createDefaultLayoutState()

export function normalizeDashboardLayout(state?: unknown): LayoutNode {
  if (!state || typeof state !== 'object') {
    return createDefaultLayoutState()
  }

  const node = state as Partial<LayoutNode>
  const persistedId =
    normalizeOptionalString((state as { id?: unknown }).id) ?? createLayoutNodeId()

  if (node.type === 'panel') {
    return {
      id: persistedId,
      type: 'panel',
      widget: normalizeWidgetInstance(node.widget ?? null),
    }
  }

  if (node.type === 'group' && Array.isArray(node.children)) {
    const sizes =
      Array.isArray(node.sizes) && node.sizes.length === node.children.length
        ? node.sizes
        : new Array(node.children.length).fill(100 / Math.max(node.children.length, 1))

    return {
      id: persistedId,
      type: 'group',
      direction: node.direction === 'vertical' ? 'vertical' : 'horizontal',
      sizes,
      children: node.children.map((child) => normalizeDashboardLayout(child)),
    }
  }

  return createDefaultLayoutState()
}

function normalizeWidgetInstance(widget: WidgetInstance): WidgetInstance {
  if (!widget) return null

  const pairColor = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'

  return {
    ...widget,
    pairColor,
    params: widget.key === 'copilot' ? null : (widget.params ?? null),
  }
}

export function serializeLayout(node: LayoutNode): PersistedLayoutNode {
  if (node.type === 'panel') {
    const widget = node.widget
    if (!widget) {
      return {
        id: node.id,
        type: 'panel',
        widget,
      }
    }
    const normalizedParams = normalizeListingParamsForStorage(widget.params ?? null)
    const nextWidget =
      widget.key === 'copilot'
        ? {
            ...widget,
            params: null,
          }
        : normalizedParams === widget.params
          ? widget
          : {
              ...widget,
              params: normalizedParams ?? null,
            }
    return {
      id: node.id,
      type: 'panel',
      widget: nextWidget,
    }
  }

  return {
    id: node.id,
    type: 'group',
    direction: node.direction,
    sizes: node.sizes,
    children: node.children.map((child) => serializeLayout(child)),
  }
}
