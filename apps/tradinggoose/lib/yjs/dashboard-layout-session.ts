import * as Y from 'yjs'
import type { PairColorContext } from '@/widgets/color-pairs'
import type { LinkedPairColor } from '@/widgets/layout'
import {
  normalizeColorPairsState,
  normalizePersistedColorPairFields,
  type PersistedColorPair,
} from '@/widgets/layout'
import {
  type DashboardLayoutDocumentContent,
  type DashboardLayoutEditPlan,
  type DashboardLayoutTopologyNode,
  type DashboardWidgetDocument,
  findDashboardTopologyPanel,
  normalizeDashboardLayoutDocumentContent,
  normalizeDashboardLayoutTopology,
  normalizeDashboardWidgetDocument,
} from '@/widgets/layout-document'
import type { PairColor } from '@/widgets/pair-colors'
import {
  type AppliedWidgetConfigMutation,
  applyWidgetConfigMutation,
  type WidgetConfigMutationPatch,
} from '@/widgets/widget-mutations'

const TOPOLOGY_KEY = 'topology'

export const getDashboardLayoutMap = (doc: Y.Doc) => doc.getMap<unknown>('layout')
export const getDashboardWidgetsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('widgets')
export const getDashboardColorPairsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('colorPairs')

const readEntries = (map: Y.Map<Y.Map<unknown>>) =>
  Object.fromEntries(Array.from(map.entries(), ([key, value]) => [key, value.toJSON()]))

export function readDashboardLayoutTopology(doc: Y.Doc): DashboardLayoutTopologyNode {
  return normalizeDashboardLayoutTopology(getDashboardLayoutMap(doc).get(TOPOLOGY_KEY))
}

export function readDashboardWidgetDocument(
  doc: Y.Doc,
  identityId: string,
  widgetKey: NonNullable<Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey']>
): DashboardWidgetDocument | null {
  const widget = getDashboardWidgetsMap(doc).get(identityId)
  return widget ? normalizeDashboardWidgetDocument(widgetKey, widget.toJSON()) : null
}

export function readDashboardColorPairContext(doc: Y.Doc, color: PairColor): PairColorContext {
  if (color === 'gray') return {}
  return normalizePersistedColorPairFields(
    getDashboardColorPairsMap(doc).get(color)?.toJSON()
  ) as PairColorContext
}

export function readDashboardColorPairsState(doc: Y.Doc) {
  return normalizeColorPairsState({
    pairs: Array.from(getDashboardColorPairsMap(doc).entries(), ([color, value]) => ({
      color,
      ...value.toJSON(),
    })),
  })
}

export function readDashboardLayoutContent(doc: Y.Doc): DashboardLayoutDocumentContent {
  return normalizeDashboardLayoutDocumentContent({
    layout: readDashboardLayoutTopology(doc),
    widgets: readEntries(getDashboardWidgetsMap(doc)),
    colorPairs: readDashboardColorPairsState(doc),
  })
}

export function seedDashboardLayoutSession(
  doc: Y.Doc,
  content: DashboardLayoutDocumentContent,
  origin?: unknown
): void {
  const normalized = normalizeDashboardLayoutDocumentContent(content)
  doc.transact(() => {
    setIfChanged(getDashboardLayoutMap(doc), TOPOLOGY_KEY, normalized.layout)
    reconcileEntries(getDashboardWidgetsMap(doc), normalized.widgets)
    reconcileEntries(getDashboardColorPairsMap(doc), colorPairEntries(normalized.colorPairs))
  }, origin)
}

export function setDashboardLayoutTopology(
  doc: Y.Doc,
  layout: DashboardLayoutTopologyNode,
  origin?: unknown
): void {
  const current = readDashboardLayoutContent(doc)
  const normalized = normalizeDashboardLayoutDocumentContent({ ...current, layout })
  doc.transact(() => {
    setIfChanged(getDashboardLayoutMap(doc), TOPOLOGY_KEY, normalized.layout)
  }, origin)
}

export function applyDashboardTopologyMutation(
  doc: Y.Doc,
  plan: DashboardLayoutEditPlan,
  origin?: unknown
): void {
  const current = readDashboardLayoutContent(doc)
  const widgets = { ...current.widgets, ...plan.createdWidgets }
  for (const identityId of plan.removedIdentityIds) delete widgets[identityId]
  const normalized = normalizeDashboardLayoutDocumentContent({
    ...current,
    layout: plan.layout,
    widgets,
  })
  doc.transact(() => {
    for (const identityId of plan.removedIdentityIds) {
      getDashboardWidgetsMap(doc).delete(identityId)
    }
    for (const [identityId, widget] of Object.entries(plan.createdWidgets)) {
      setEntry(getDashboardWidgetsMap(doc), identityId, widget)
    }
    setIfChanged(getDashboardLayoutMap(doc), TOPOLOGY_KEY, normalized.layout)
  }, origin)
}

export function applyDashboardWidgetMutation(
  doc: Y.Doc,
  mutation: {
    identityId: string
    widget: DashboardWidgetDocument
    colorPairs?: Array<{ color: LinkedPairColor; value: PairColorContext | null }>
  },
  origin?: unknown
): void {
  const layout = readDashboardLayoutTopology(doc)
  const panel = findDashboardPanelByIdentityId(layout, mutation.identityId)
  if (!panel?.widgetKey) {
    throw new Error(`Dashboard layout does not reference widget ${mutation.identityId}`)
  }
  const widget = normalizeDashboardWidgetDocument(panel.widgetKey, mutation.widget)
  doc.transact(() => {
    setEntry(getDashboardWidgetsMap(doc), mutation.identityId, widget)
    for (const change of mutation.colorPairs ?? []) {
      if (!change.value || Object.keys(change.value).length === 0) {
        getDashboardColorPairsMap(doc).delete(change.color)
      } else {
        setEntry(
          getDashboardColorPairsMap(doc),
          change.color,
          normalizePersistedColorPairFields(change.value)
        )
      }
    }
  }, origin)
}

function findDashboardPanelByIdentityId(
  node: DashboardLayoutTopologyNode,
  identityId: string
): Extract<DashboardLayoutTopologyNode, { type: 'panel' }> | null {
  if (node.type === 'panel') return node.identityId === identityId ? node : null
  for (const child of node.children) {
    const found = findDashboardPanelByIdentityId(child, identityId)
    if (found) return found
  }
  return null
}

export function applyDashboardWidgetConfigPatch(
  doc: Y.Doc,
  panelId: string,
  patch: WidgetConfigMutationPatch,
  origin?: unknown
): AppliedWidgetConfigMutation {
  const currentLayout = readDashboardLayoutTopology(doc)
  const panel = findDashboardTopologyPanel(currentLayout, panelId)
  if (!panel) throw new Error(`Unknown dashboard panel ${panelId}`)
  if (!panel.identityId || !panel.widgetKey) {
    throw new Error(`Dashboard panel ${panelId} has no widget; use a layout mutation`)
  }
  const identityId = panel.identityId
  const widgetKey = panel.widgetKey
  const widget = readDashboardWidgetDocument(doc, identityId, widgetKey)
  if (!widget) throw new Error(`Dashboard panel ${panelId} references a missing widget`)
  const result = applyWidgetConfigMutation({
    widgetKey,
    widget,
    colorPairs: readDashboardColorPairsState(doc),
    panelId,
    patch,
  })

  doc.transact(() => {
    setEntry(getDashboardWidgetsMap(doc), identityId, result.widgetDocument)
    for (const diff of result.colorPairDiff) {
      if (Object.keys(diff.after).length === 0) {
        getDashboardColorPairsMap(doc).delete(diff.color)
      } else {
        setEntry(getDashboardColorPairsMap(doc), diff.color, diff.after)
      }
    }
  }, origin)
  return result
}

function colorPairEntries(state: { pairs: PersistedColorPair[] }) {
  return Object.fromEntries(state.pairs.map(({ color, ...pair }) => [color, pair])) as Record<
    string,
    Omit<PersistedColorPair, 'color'>
  >
}

function reconcileEntries<T extends Record<string, unknown>>(
  target: Y.Map<Y.Map<unknown>>,
  entries: Record<string, T>
): void {
  target.forEach((_value, key) => {
    if (!entries[key]) target.delete(key)
  })
  for (const [key, value] of Object.entries(entries)) setEntry(target, key, value)
}

function setEntry(
  target: Y.Map<Y.Map<unknown>>,
  key: string,
  values: Record<string, unknown>
): void {
  let entry = target.get(key)
  if (!entry) {
    entry = new Y.Map<unknown>()
    target.set(key, entry)
  }
  entry.forEach((_value, field) => {
    if (!Object.hasOwn(values, field)) entry?.delete(field)
  })
  for (const [field, value] of Object.entries(values)) setIfChanged(entry, field, value)
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (!map.has(key) || JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
    map.set(key, value)
  }
}
