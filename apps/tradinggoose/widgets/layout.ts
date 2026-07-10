import { type ListingIdentity, toListingValueObject } from '@/lib/listing/identity'
import { normalizeOptionalString } from '@/lib/utils'
import type { PairColor } from '@/widgets/pair-colors'
import { isPairColor } from '@/widgets/pair-colors'

export type LinkedPairColor = Exclude<PairColor, 'gray'>

export type PersistedColorPair = {
  color: LinkedPairColor
  workflowId?: string | null
  watchlistId?: string | null
  listing?: ListingIdentity | null
  indicatorId?: string | null
  mcpServerId?: string | null
  customToolId?: string | null
  skillId?: string | null
}

export type PersistedColorPairsState = {
  pairs: PersistedColorPair[]
}

export const PERSISTED_COLOR_PAIR_FIELDS = [
  'workflowId',
  'watchlistId',
  'listing',
  'indicatorId',
  'mcpServerId',
  'customToolId',
  'skillId',
] as const

type PersistedColorPairSource = PersistedColorPair | Record<string, unknown> | null | undefined

export const createDefaultColorPairsState = (): PersistedColorPairsState => ({
  pairs: [],
})

export function normalizeListingIdentity(value: unknown): ListingIdentity | null {
  if (!value || typeof value !== 'object') return null
  return toListingValueObject(value as any) ?? null
}

export function normalizePersistedColorPairFields(
  source: PersistedColorPairSource
): Omit<PersistedColorPair, 'color'> {
  const next: Omit<PersistedColorPair, 'color'> = {}
  if (!source || typeof source !== 'object') {
    return next
  }

  for (const key of PERSISTED_COLOR_PAIR_FIELDS) {
    if (key === 'listing') {
      const listing = normalizeListingIdentity((source as { listing?: unknown }).listing)
      if (listing) next.listing = listing
      continue
    }

    const value = normalizeOptionalString((source as Record<string, unknown>)[key])
    if (value) {
      next[key] = value
    }
  }

  return next
}

export function normalizeColorPairsState(state?: unknown): PersistedColorPairsState {
  if (!state || typeof state !== 'object') {
    return createDefaultColorPairsState()
  }

  const rawPairs = Array.isArray((state as { pairs?: unknown }).pairs)
    ? ((state as { pairs?: unknown }).pairs as unknown[])
    : []
  const seen = new Set<LinkedPairColor>()
  const pairs: PersistedColorPair[] = []

  for (const raw of rawPairs) {
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const color = (raw as { color?: unknown }).color
    if (!isPairColor(color) || color === 'gray' || seen.has(color)) {
      continue
    }

    const context = normalizePersistedColorPairFields(raw as Record<string, unknown>)
    if (Object.keys(context).length === 0) continue

    pairs.push({ color, ...context })
    seen.add(color)
  }

  return { pairs: pairs.sort((left, right) => left.color.localeCompare(right.color)) }
}

export type WidgetInstance = {
  key: string
  pairColor?: PairColor
  params?: Record<string, unknown> | null
} | null

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
        widget: null,
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
            widget: null,
          },
          {
            id: createLayoutNodeId(),
            type: 'panel',
            widget: null,
          },
        ],
      },
      {
        id: createLayoutNodeId(),
        type: 'panel',
        widget: null,
      },
    ],
  }
}

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
      widget: sanitizeWidgetInstance(node.widget ?? null),
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

function sanitizeWidgetInstance(widget: WidgetInstance): WidgetInstance {
  if (!widget) return null

  const pairColor = isPairColor(widget.pairColor) ? widget.pairColor : 'gray'

  return {
    ...widget,
    pairColor,
    params: widget.key === 'copilot' ? null : (widget.params ?? null),
  }
}
