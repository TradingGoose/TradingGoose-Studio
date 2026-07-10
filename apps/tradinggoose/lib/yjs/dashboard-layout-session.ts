import { isEqual } from 'lodash'
import * as Y from 'yjs'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
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
import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import {
  type AppliedWidgetConfigMutation,
  applyWidgetConfigMutation,
  type WidgetConfigMutationPatch,
} from '@/widgets/widget-mutations'

const TOPOLOGY_KEY = 'topology'

export type DashboardLayoutDirtyBatch = {
  generation: number
  layout: boolean
  widgetIdentityIds: ReadonlySet<string>
  pairColors: ReadonlySet<string>
}

type DashboardLayoutDirtyTracker = {
  generation: number
  layout: boolean
  widgetIdentityIds: Set<string>
  pairColors: Set<string>
  inFlight: DashboardLayoutDirtyBatch | null
  seenTransactions: WeakSet<Y.Transaction>
  dispose: () => void
}

const dashboardLayoutDirtyTrackers = new WeakMap<Y.Doc, DashboardLayoutDirtyTracker>()

export const getDashboardLayoutMap = (doc: Y.Doc) => doc.getMap<unknown>('layout')
export const getDashboardWidgetsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('widgets')
export const getDashboardColorPairsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('colorPairs')

function collectChangedEntryKeys(events: Y.YEvent<Y.AbstractType<unknown>>[]): Set<string> {
  const keys = new Set<string>()
  for (const event of events) {
    const [entryKey] = event.path
    if (typeof entryKey === 'string') keys.add(entryKey)
    if (event.path.length === 0 && event instanceof Y.YMapEvent) {
      for (const key of event.keysChanged) keys.add(key)
    }
  }
  return keys
}

function touchDirtyGeneration(
  tracker: DashboardLayoutDirtyTracker,
  transaction: Y.Transaction
): void {
  if (tracker.seenTransactions.has(transaction)) return
  tracker.seenTransactions.add(transaction)
  tracker.generation += 1
}

export function ensureDashboardLayoutDirtyTracker(doc: Y.Doc): void {
  if (dashboardLayoutDirtyTrackers.has(doc)) return

  const layout = getDashboardLayoutMap(doc)
  const widgets = getDashboardWidgetsMap(doc)
  const colorPairs = getDashboardColorPairsMap(doc)
  const tracker: DashboardLayoutDirtyTracker = {
    generation: 0,
    layout: false,
    widgetIdentityIds: new Set(),
    pairColors: new Set(),
    inFlight: null,
    seenTransactions: new WeakSet(),
    dispose: () => undefined,
  }

  const onLayout = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
    if (transaction.origin === YJS_ORIGINS.SYSTEM || events.length === 0) return
    touchDirtyGeneration(tracker, transaction)
    tracker.layout = true
  }
  const onWidgets = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction) => {
    if (transaction.origin === YJS_ORIGINS.SYSTEM) return
    const keys = collectChangedEntryKeys(events)
    if (keys.size === 0) return
    touchDirtyGeneration(tracker, transaction)
    for (const key of keys) tracker.widgetIdentityIds.add(key)
  }
  const onColorPairs = (
    events: Y.YEvent<Y.AbstractType<unknown>>[],
    transaction: Y.Transaction
  ) => {
    if (transaction.origin === YJS_ORIGINS.SYSTEM) return
    const keys = collectChangedEntryKeys(events)
    if (keys.size === 0) return
    touchDirtyGeneration(tracker, transaction)
    for (const key of keys) tracker.pairColors.add(key)
  }
  const dispose = () => {
    layout.unobserveDeep(onLayout)
    widgets.unobserveDeep(onWidgets)
    colorPairs.unobserveDeep(onColorPairs)
    dashboardLayoutDirtyTrackers.delete(doc)
  }

  tracker.dispose = dispose
  dashboardLayoutDirtyTrackers.set(doc, tracker)
  layout.observeDeep(onLayout)
  widgets.observeDeep(onWidgets)
  colorPairs.observeDeep(onColorPairs)
  doc.once('destroy', dispose)
}

export function beginDashboardLayoutDirtyFlush(doc: Y.Doc): DashboardLayoutDirtyBatch | null {
  const tracker = dashboardLayoutDirtyTrackers.get(doc)
  if (!tracker) throw new Error('Dashboard layout dirty tracker is not installed')
  if (tracker.inFlight) throw new Error('Dashboard layout persistence is already in flight')
  if (!tracker.layout && tracker.widgetIdentityIds.size === 0 && tracker.pairColors.size === 0) {
    return null
  }

  const batch: DashboardLayoutDirtyBatch = {
    generation: tracker.generation,
    layout: tracker.layout,
    widgetIdentityIds: tracker.widgetIdentityIds,
    pairColors: tracker.pairColors,
  }
  tracker.layout = false
  tracker.widgetIdentityIds = new Set()
  tracker.pairColors = new Set()
  tracker.inFlight = batch
  return batch
}

export function completeDashboardLayoutDirtyFlush(
  doc: Y.Doc,
  batch: DashboardLayoutDirtyBatch
): void {
  const tracker = dashboardLayoutDirtyTrackers.get(doc)
  if (!tracker || tracker.inFlight !== batch) {
    throw new Error('Dashboard layout dirty batch is not current')
  }
  tracker.inFlight = null
}

export function failDashboardLayoutDirtyFlush(doc: Y.Doc, batch: DashboardLayoutDirtyBatch): void {
  const tracker = dashboardLayoutDirtyTrackers.get(doc)
  if (!tracker || tracker.inFlight !== batch) {
    throw new Error('Dashboard layout dirty batch is not current')
  }
  tracker.layout ||= batch.layout
  for (const identityId of batch.widgetIdentityIds) tracker.widgetIdentityIds.add(identityId)
  for (const color of batch.pairColors) tracker.pairColors.add(color)
  tracker.inFlight = null
}

export function isDashboardLayoutDirty(doc: Y.Doc): boolean {
  const tracker = dashboardLayoutDirtyTrackers.get(doc)
  return Boolean(
    tracker &&
      (tracker.inFlight ||
        tracker.layout ||
        tracker.widgetIdentityIds.size > 0 ||
        tracker.pairColors.size > 0)
  )
}

const readEntries = (map: Y.Map<Y.Map<unknown>>) =>
  Object.fromEntries(Array.from(map.entries(), ([key, value]) => [key, value.toJSON()]))

export function readDashboardLayoutTopology(doc: Y.Doc): DashboardLayoutTopologyNode {
  return normalizeDashboardLayoutTopology(getDashboardLayoutMap(doc).get(TOPOLOGY_KEY))
}

export function readDashboardWidgetDocument(
  doc: Y.Doc,
  identityId: string,
  widgetKey: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey']
): DashboardWidgetDocument | null {
  const widget = getDashboardWidgetsMap(doc).get(identityId)
  return widget ? normalizeDashboardWidgetDocument(widgetKey, widget.toJSON()) : null
}

export function readDashboardColorPairContext(doc: Y.Doc, color: PairColor): PairColorContext {
  if (color === 'gray') return {}
  const pair = readDashboardColorPairsState(doc).pairs.find(
    (candidate) => candidate.color === color
  )
  return pair ? normalizePersistedColorPairFields(pair) : {}
}

export function readDashboardColorPairsState(doc: Y.Doc) {
  const pairs = Array.from(getDashboardColorPairsMap(doc).entries(), ([color, value]) => {
    if (!isPairColor(color) || color === 'gray') {
      throw new Error(`dashboard color pair ${color} is invalid`)
    }
    const raw = value.toJSON()
    const normalized = normalizePersistedColorPairFields(raw)
    if (Object.keys(normalized).length === 0 || !isEqual(raw, normalized)) {
      throw new Error(`dashboard color pair ${color} context must be canonical`)
    }
    return { color, ...normalized }
  })
  return normalizeColorPairsState({ pairs })
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
  if (!panel.widgetKey) {
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
