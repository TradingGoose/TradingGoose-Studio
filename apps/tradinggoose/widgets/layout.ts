import { resolveListingKey, toListingValueObject, type ListingIdentity } from '@/lib/market/listings'
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
  copilotChatId?: string | null
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

const normalizeListingIdentity = (value: unknown): ListingIdentity | null => {
  if (!value) return null
  const listing = toListingValueObject(value as any)
  if (!listing) return null
  if (!resolveListingKey(listing)) return null
  return listing
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

    const workflowId =
      typeof (raw as { workflowId?: unknown }).workflowId === 'string' &&
      ((raw as { workflowId?: unknown }).workflowId as string).trim().length > 0
        ? ((raw as { workflowId?: unknown }).workflowId as string)
        : null
    const copilotChatId =
      typeof (raw as { copilotChatId?: unknown }).copilotChatId === 'string' &&
      ((raw as { copilotChatId?: unknown }).copilotChatId as string).trim().length > 0
        ? ((raw as { copilotChatId?: unknown }).copilotChatId as string)
        : null
    const listing = normalizeListingIdentity((raw as { listing?: unknown }).listing)

    normalized.push({
      color: rawColor,
      workflowId,
      listing,
      copilotChatId,
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

  return {
    ...widget,
    pairColor,
  }
}

export function serializeLayout(node: LayoutNode): PersistedLayoutNode {
  if (node.type === 'panel') {
    return {
      type: 'panel',
      widget: node.widget,
    }
  }

  return {
    type: 'group',
    direction: node.direction,
    sizes: node.sizes,
    children: node.children.map((child) => serializeLayout(child)),
  }
}
