import type * as Y from 'yjs'
import type { PairColorContext } from '@/widgets/color-pairs'
import {
  type DashboardLayoutDocument,
  type DashboardLayoutTopologyNode,
  type DashboardWidgetDocument,
  normalizeDashboardColorPairDocument,
  normalizeDashboardLayoutDocument,
  normalizeDashboardLayoutTopology,
  normalizeDashboardWidgetDocument,
  normalizeDashboardWidgetStorageDocument,
} from '@/widgets/layout-document'

const TOPOLOGY_KEY = 'topology'

export const getDashboardLayoutMap = (doc: Y.Doc) => doc.getMap<unknown>('layout')
export const getDashboardWidgetMap = (doc: Y.Doc) => doc.getMap<unknown>('widget')
export const getDashboardColorPairMap = (doc: Y.Doc) => doc.getMap<unknown>('colorPair')

export function readDashboardLayoutTopology(doc: Y.Doc): DashboardLayoutTopologyNode {
  return normalizeDashboardLayoutTopology(getDashboardLayoutMap(doc).get(TOPOLOGY_KEY))
}

export function readDashboardLayoutDocument(doc: Y.Doc): DashboardLayoutDocument {
  return { layout: readDashboardLayoutTopology(doc) }
}

export function seedDashboardLayoutSession(
  doc: Y.Doc,
  content: DashboardLayoutDocument,
  origin?: unknown
): void {
  const normalized = normalizeDashboardLayoutDocument(content)
  doc.transact(() => {
    setIfChanged(getDashboardLayoutMap(doc), TOPOLOGY_KEY, normalized.layout)
  }, origin)
}

export function setDashboardLayoutTopology(
  doc: Y.Doc,
  layout: DashboardLayoutTopologyNode,
  origin?: unknown
): void {
  const normalized = normalizeDashboardLayoutTopology(layout)
  doc.transact(() => {
    setIfChanged(getDashboardLayoutMap(doc), TOPOLOGY_KEY, normalized)
  }, origin)
}

export function readDashboardWidgetDocument(
  doc: Y.Doc,
  widgetKey?: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey']
): DashboardWidgetDocument {
  const value = getDashboardWidgetMap(doc).toJSON()
  return widgetKey === undefined
    ? normalizeDashboardWidgetStorageDocument(value)
    : normalizeDashboardWidgetDocument(widgetKey, value)
}

export function seedDashboardWidgetSession(
  doc: Y.Doc,
  content: DashboardWidgetDocument,
  origin?: unknown
): void {
  const normalized = normalizeDashboardWidgetStorageDocument(content)
  doc.transact(() => replaceMap(getDashboardWidgetMap(doc), normalized), origin)
}

export function setDashboardWidgetDocument(
  doc: Y.Doc,
  widgetKey: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey'],
  content: DashboardWidgetDocument,
  origin?: unknown
): void {
  const normalized = normalizeDashboardWidgetDocument(widgetKey, content)
  doc.transact(() => replaceMap(getDashboardWidgetMap(doc), normalized), origin)
}

export function readDashboardColorPairDocument(doc: Y.Doc): PairColorContext {
  return normalizeDashboardColorPairDocument(getDashboardColorPairMap(doc).toJSON())
}

export function seedDashboardColorPairSession(
  doc: Y.Doc,
  content: PairColorContext,
  origin?: unknown
): void {
  const normalized = normalizeDashboardColorPairDocument(content)
  doc.transact(() => replaceMap(getDashboardColorPairMap(doc), normalized), origin)
}

export function setDashboardColorPairDocument(
  doc: Y.Doc,
  content: PairColorContext,
  origin?: unknown
): void {
  seedDashboardColorPairSession(doc, content, origin)
}

function replaceMap(map: Y.Map<unknown>, values: Record<string, unknown>): void {
  map.forEach((_value, key) => {
    if (!Object.hasOwn(values, key)) map.delete(key)
  })
  for (const [key, value] of Object.entries(values)) setIfChanged(map, key, value)
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (!map.has(key) || JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
    map.set(key, value)
  }
}
