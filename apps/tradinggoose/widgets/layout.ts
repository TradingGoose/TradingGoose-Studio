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

    pairs.push({
      color,
      ...normalizePersistedColorPairFields(raw as Record<string, unknown>),
    })
    seen.add(color)
  }

  return { pairs }
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

type PersistedLayoutNode =
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

const normalizeListingParamsForStorage = (
  params?: Record<string, unknown> | null
): Record<string, unknown> | null | undefined => {
  if (!params || typeof params !== 'object') return params
  if (!('listing' in params)) return params
  const listing = normalizeListingIdentity((params as { listing?: unknown }).listing)
  return { ...params, listing }
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
            widget: { key: 'empty', pairColor: 'gray', params: null },
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

export function updateDashboardLayoutGroupSizes(
  node: LayoutNode,
  groupId: string,
  sizes: number[]
): LayoutNode {
  if (node.type === 'panel') {
    return node
  }

  if (node.id === groupId) {
    if (areDashboardLayoutGroupSizesEqual(node.sizes, sizes)) {
      return node
    }

    return {
      ...node,
      sizes: [...sizes],
    }
  }

  const updatedChildren = node.children.map((child) =>
    updateDashboardLayoutGroupSizes(child, groupId, sizes)
  )
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  return hasChanged ? { ...node, children: updatedChildren } : node
}

export function findDashboardLayoutParentGroupId(
  node: LayoutNode,
  childId: string,
  parentId: string | null = null
): string | null {
  if (node.type === 'panel') {
    return node.id === childId ? parentId : null
  }

  for (const child of node.children) {
    const found = findDashboardLayoutParentGroupId(child, childId, node.id)
    if (found) {
      return found
    }
  }

  return null
}

export function splitDashboardLayoutPanelIntoVerticalGroup(
  node: LayoutNode,
  panelId: string
): LayoutNode {
  return splitDashboardLayoutPanelIntoGroup(node, panelId, 'vertical')
}

export function splitDashboardLayoutPanelIntoHorizontalGroup(
  node: LayoutNode,
  panelId: string
): LayoutNode {
  return splitDashboardLayoutPanelIntoGroup(node, panelId, 'horizontal')
}

export function closeDashboardLayoutPanelGroup(node: LayoutNode, panelId: string): LayoutNode {
  if (node.type === 'panel') {
    return node
  }

  const directIndex = node.children.findIndex(
    (child) => child.type === 'panel' && child.id === panelId
  )

  if (directIndex !== -1) {
    const remainingChildren = node.children.filter((_, index) => index !== directIndex)

    if (remainingChildren.length === 0) {
      return node
    }

    if (remainingChildren.length === 1) {
      const survivor = remainingChildren[0]

      if (survivor.type === 'panel') {
        return {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateDashboardWidgetInstance(survivor.widget),
        }
      }

      return {
        ...survivor,
        id: createLayoutNodeId(),
      }
    }

    return {
      ...node,
      id: createLayoutNodeId(),
      children: remainingChildren,
      sizes: normalizeRemainingDashboardLayoutSizes(
        node.sizes,
        directIndex,
        remainingChildren.length
      ),
    }
  }

  const updatedChildren = node.children.map((child) =>
    closeDashboardLayoutPanelGroup(child, panelId)
  )
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  return hasChanged ? { ...node, children: updatedChildren } : node
}

function areDashboardLayoutGroupSizesEqual(
  a: number[] | undefined,
  b: number[] | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return !a && !b
  if (a.length !== b.length) return false

  for (let index = 0; index < a.length; index += 1) {
    if (Math.abs(a[index] - b[index]) > 0.01) {
      return false
    }
  }

  return true
}

function splitDashboardLayoutPanelIntoGroup(
  node: LayoutNode,
  panelId: string,
  direction: 'vertical' | 'horizontal'
): LayoutNode {
  if (node.type === 'panel') {
    if (node.id !== panelId) {
      return node
    }

    return {
      id: createLayoutNodeId(),
      type: 'group',
      direction,
      sizes: [50, 50],
      children: [
        {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateDashboardWidgetInstance(node.widget),
        },
        {
          id: createLayoutNodeId(),
          type: 'panel',
          widget: duplicateDashboardWidgetInstance(node.widget),
        },
      ],
    }
  }

  const updatedChildren = node.children.map((child) =>
    splitDashboardLayoutPanelIntoGroup(child, panelId, direction)
  )
  const hasChanged = updatedChildren.some((child, index) => child !== node.children[index])

  return hasChanged ? { ...node, children: updatedChildren } : node
}

function duplicateDashboardWidgetInstance(widget: WidgetInstance): WidgetInstance {
  if (!widget) {
    return {
      key: 'empty',
      pairColor: 'gray',
      params: null,
    }
  }

  return {
    key: widget.key,
    pairColor: widget.pairColor ?? 'gray',
    params: widget.params ? { ...widget.params } : null,
  }
}

function normalizeRemainingDashboardLayoutSizes(
  sizes: number[],
  removedIndex: number,
  nextLength: number
): number[] {
  if (nextLength === 0) {
    return []
  }

  const remaining = sizes.filter((_, index) => index !== removedIndex)
  const total = remaining.reduce((sum, value) => sum + value, 0)

  if (total <= 0) {
    const equalSize = 100 / nextLength
    return new Array(nextLength).fill(equalSize)
  }

  return remaining.map((value) => (value / total) * 100)
}
