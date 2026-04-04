import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { normalizeOptionalString } from '@/lib/utils'
import type { PairReviewTarget } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { isPairColor } from '@/widgets/pair-colors'
import { normalizeWorkflowCopilotWidgetParams } from '@/widgets/widgets/workflow_copilot/review-target-params'

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
  reviewTarget?: PairReviewTarget
  indicatorId?: string | null
  mcpServerId?: string | null
  customToolId?: string | null
  skillId?: string | null
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
      type: 'panel'
      widget: WidgetInstance
    }
  | {
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

  // Data Chart keeps provider and chart configuration widget-local while linked listings
  // continue to resolve from the shared pair store.
  if (widget?.key === 'data_chart') {
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

const normalizeListingWithResolvedFields = (value: unknown): ListingIdentity | null => {
  if (!value || typeof value !== 'object') return null
  const identity = toListingValueObject(value as any)
  if (!identity) return null

  return {
    ...(value as Record<string, unknown>),
    listing_id: identity.listing_id,
    base_id: identity.base_id,
    quote_id: identity.quote_id,
    listing_type: identity.listing_type,
  } as ListingIdentity
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

    const rawTarget = (raw as { reviewTarget?: unknown }).reviewTarget
    const isNestedTarget = rawTarget && typeof rawTarget === 'object'

    const reviewTarget: PairReviewTarget = {
      reviewSessionId: normalizeOptionalString(
        isNestedTarget ? (rawTarget as any).reviewSessionId : (raw as any).reviewSessionId
      ),
      reviewEntityKind: normalizeOptionalString(
        isNestedTarget ? (rawTarget as any).reviewEntityKind : (raw as any).reviewEntityKind
      ),
      reviewEntityId: normalizeOptionalString(
        isNestedTarget ? (rawTarget as any).reviewEntityId : (raw as any).reviewEntityId
      ),
      reviewDraftSessionId: normalizeOptionalString(
        isNestedTarget ? (rawTarget as any).reviewDraftSessionId : (raw as any).reviewDraftSessionId
      ),
      reviewModel: normalizeOptionalString(
        isNestedTarget ? (rawTarget as any).reviewModel : (raw as any).reviewModel
      ),
    }

    const hasReviewTarget = Object.values(reviewTarget).some(v => v != null)

    const listing = normalizeListingWithResolvedFields((raw as { listing?: unknown }).listing)
    const indicatorId = normalizeOptionalString((raw as { indicatorId?: unknown }).indicatorId)
    const mcpServerId = normalizeOptionalString((raw as { mcpServerId?: unknown }).mcpServerId)
    const customToolId = normalizeOptionalString((raw as { customToolId?: unknown }).customToolId)
    const skillId = normalizeOptionalString((raw as { skillId?: unknown }).skillId)

    normalized.push({
      color: rawColor,
      workflowId,
      listing,
      ...(hasReviewTarget ? { reviewTarget } : {}),
      indicatorId,
      mcpServerId,
      customToolId,
      skillId,
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

  if (node.type === 'panel') {
    return {
      id: createLayoutNodeId(),
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
      id: createLayoutNodeId(),
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

  let params = widget.params ?? null
  if (widget.key === 'workflow_copilot') {
    const normalized = normalizeWorkflowCopilotWidgetParams(params)
    params = Object.keys(normalized).length > 0 ? normalized : null
  }

  return {
    ...widget,
    pairColor,
    params,
  }
}

export function serializeLayout(node: LayoutNode): PersistedLayoutNode {
  if (node.type === 'panel') {
    const widget = node.widget
    if (!widget) {
      return {
        type: 'panel',
        widget,
      }
    }
    const normalizedParams = normalizeListingParamsForStorage(widget.params ?? null)
    const nextWidget =
      normalizedParams === widget.params
        ? widget
        : {
            ...widget,
            params: normalizedParams ?? null,
          }
    return {
      type: 'panel',
      widget: nextWidget,
    }
  }

  return {
    type: 'group',
    direction: node.direction,
    sizes: node.sizes,
    children: node.children.map((child) => serializeLayout(child)),
  }
}
