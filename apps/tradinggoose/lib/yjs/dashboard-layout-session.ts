import * as Y from 'yjs'
import { toListingValueObject } from '@/lib/listing/identity'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import type { PairColorContext } from '@/widgets/color-pairs'
import {
  createDashboardLayoutValidationError,
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
const UNSAFE_WIDGET_PARAM_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

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
  const map = getDashboardWidgetMap(doc)
  const value = { ...map.toJSON(), params: readDashboardWidgetParams(map) }
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
  doc.transact(() => replaceDashboardWidgetMap(getDashboardWidgetMap(doc), normalized), origin)
}

export function applyDashboardWidgetDocumentDelta(
  doc: Y.Doc,
  widgetKey: Extract<DashboardLayoutTopologyNode, { type: 'panel' }>['widgetKey'],
  baseline: DashboardWidgetDocument,
  target: DashboardWidgetDocument,
  origin?: unknown
): void {
  const before = normalizeDashboardWidgetDocument(widgetKey, baseline)
  const after = normalizeDashboardWidgetDocument(widgetKey, target)
  doc.transact(() => applyDashboardWidgetDelta(getDashboardWidgetMap(doc), before, after), origin)
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
  doc.transact(() => replaceFlatMap(getDashboardColorPairMap(doc), normalized), origin)
}

export function applyDashboardColorPairDocumentDelta(
  doc: Y.Doc,
  baseline: PairColorContext,
  target: PairColorContext,
  origin?: unknown
): void {
  const before = normalizeDashboardColorPairDocument(baseline)
  const after = normalizeDashboardColorPairDocument(target)
  doc.transact(() => applyFlatMapDelta(getDashboardColorPairMap(doc), before, after), origin)
}

function replaceDashboardWidgetMap(map: Y.Map<unknown>, value: DashboardWidgetDocument): void {
  clearMap(map)
  map.set('pairColor', value.pairColor)
  const params = new Y.Map<unknown>()
  map.set('params', params)
  for (const [key, param] of flattenWidgetParams(value.params)) params.set(key, param)
}

function replaceFlatMap(map: Y.Map<unknown>, values: Record<string, unknown>): void {
  clearMap(map)
  for (const [key, value] of Object.entries(values)) map.set(key, value)
}

function clearMap(map: Y.Map<unknown>): void {
  map.forEach((_value, key) => {
    map.delete(key)
  })
}

function applyDashboardWidgetDelta(
  map: Y.Map<unknown>,
  before: DashboardWidgetDocument,
  after: DashboardWidgetDocument
): void {
  if (!areJsonValuesEqual(before.pairColor, after.pairColor)) {
    map.set('pairColor', after.pairColor)
  }
  applyMapEntriesDelta(
    getDashboardWidgetParamsMap(map),
    flattenWidgetParams(before.params),
    flattenWidgetParams(after.params)
  )
}

function readDashboardWidgetParams(map: Y.Map<unknown>): Record<string, unknown> | null {
  const entries = [...getDashboardWidgetParamsMap(map).entries()]
  if (entries.length === 0) return null

  const params: Record<string, unknown> = {}
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    setWidgetParamAtPath(params, decodeWidgetParamPath(key), value)
  }
  return params
}

function getDashboardWidgetParamsMap(map: Y.Map<unknown>): Y.Map<unknown> {
  const params = map.get('params')
  if (!(params instanceof Y.Map)) {
    throw createDashboardLayoutValidationError(
      'widget.params',
      'Dashboard widget params must use a structured Y.Map'
    )
  }
  return params
}

function applyFlatMapDelta(
  map: Y.Map<unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): void {
  applyMapEntriesDelta(map, new Map(Object.entries(before)), new Map(Object.entries(after)))
}

function applyMapEntriesDelta(
  map: Y.Map<unknown>,
  before: Map<string, unknown>,
  after: Map<string, unknown>
): void {
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (!after.has(key)) {
      map.delete(key)
    } else if (!before.has(key) || !areJsonValuesEqual(before.get(key), after.get(key))) {
      map.set(key, after.get(key))
    }
  }
}

function flattenWidgetParams(params: Record<string, unknown> | null): Map<string, unknown> {
  const entries = new Map<string, unknown>()
  if (!params) return entries
  for (const [key, value] of Object.entries(params)) {
    flattenWidgetParamValue(entries, [key], value)
  }
  return entries
}

function flattenWidgetParamValue(
  entries: Map<string, unknown>,
  path: string[],
  value: unknown
): void {
  if (isNestedWidgetParamsRecord(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      flattenWidgetParamValue(entries, [...path, key], child)
    }
    return
  }
  entries.set(encodeWidgetParamPath(path), value)
}

function isNestedWidgetParamsRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    toListingValueObject(value) === null &&
    toPortfolioValueObject(value) === null
  )
}

function encodeWidgetParamPath(path: string[]): string {
  assertSafeWidgetParamPath(path)
  return JSON.stringify(path)
}

function decodeWidgetParamPath(value: string): string[] {
  try {
    const path = JSON.parse(value)
    if (Array.isArray(path) && path.length > 0 && path.every((part) => typeof part === 'string')) {
      assertSafeWidgetParamPath(path)
      return path
    }
  } catch {
    // Invalid JSON and unsafe paths share one canonical storage failure.
  }
  throw createDashboardLayoutValidationError(
    'widget.params',
    'Widget params must use encoded paths'
  )
}

function assertSafeWidgetParamPath(path: readonly string[]): void {
  if (path.some((part) => UNSAFE_WIDGET_PARAM_PATH_SEGMENTS.has(part))) {
    throw createDashboardLayoutValidationError(
      'widget.params',
      'Widget params contain an unsafe path'
    )
  }
}

function setWidgetParamAtPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown
): void {
  let current = target
  for (const key of path.slice(0, -1)) {
    const next = current[key]
    if (!isNestedWidgetParamsRecord(next)) current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  current[path[path.length - 1]!] = value
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (!map.has(key) || JSON.stringify(map.get(key)) !== JSON.stringify(value)) {
    map.set(key, value)
  }
}
