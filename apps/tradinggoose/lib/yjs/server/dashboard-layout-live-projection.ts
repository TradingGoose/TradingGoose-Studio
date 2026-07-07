import type * as Y from 'yjs'
import { readDefaultDashboardLayoutReferenceParams } from '@/lib/dashboard-layouts/operations'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getEntityFields,
  getEntityWorkspaceId,
  getFieldsMap,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  dashboardLayoutNeedsDefaultReferenceParams,
  initializeDashboardLayoutLinkedParams,
  type DashboardLayoutDocumentFields,
} from '@/widgets/layout-document'
import type { LayoutNode, WidgetInstance } from '@/widgets/layout'

const logger = createLogger('DashboardLayoutLiveProjection')

const attachedDocs = new WeakSet<Y.Doc>()
const projectionQueues = new WeakMap<Y.Doc, Promise<void>>()
const lastProjectionInputs = new WeakMap<Y.Doc, string>()

export function attachDashboardLayoutLiveProjection(doc: Y.Doc): void {
  if (attachedDocs.has(doc)) return
  attachedDocs.add(doc)

  getFieldsMap(doc).observe((event, transaction) => {
    if (transaction.origin === YJS_ORIGINS.SYSTEM) return
    if (!event.keysChanged.has('layout') && !event.keysChanged.has('colorPairs')) return
    void projectDashboardLayoutLiveState(doc).catch((error) => {
      logger.error('Failed to project dashboard layout linked params', { error })
    })
  })

  void projectDashboardLayoutLiveState(doc, { force: true }).catch((error) => {
    logger.error('Failed to project initial dashboard layout linked params', { error })
  })
}

export function projectDashboardLayoutLiveState(
  doc: Y.Doc,
  options: { force?: boolean } = {}
): Promise<void> {
  const previous = projectionQueues.get(doc) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => projectDashboardLayoutLiveStateNow(doc, options.force === true))
  const tracked = next.catch(() => undefined)
  projectionQueues.set(doc, tracked)
  return next.finally(() => {
    if (projectionQueues.get(doc) === tracked) {
      projectionQueues.delete(doc)
    }
  })
}

async function projectDashboardLayoutLiveStateNow(doc: Y.Doc, force: boolean): Promise<void> {
  const current = getEntityFields(doc, 'dashboard_layout') as DashboardLayoutDocumentFields
  const inputSignature = projectionInputSignature(current)
  if (!force && lastProjectionInputs.get(doc) === inputSignature) return

  const initializedWithoutDefaults = initializeDashboardLayoutLinkedParams(current)
  const defaultReferences = dashboardLayoutNeedsDefaultReferenceParams(
    initializedWithoutDefaults.layout
  )
    ? await readDefaultReferences(doc)
    : {}
  const projected = initializeDashboardLayoutLinkedParams(current, defaultReferences)
  lastProjectionInputs.set(doc, projectionInputSignature(projected))

  if (stableStringifyJsonValue(current) === stableStringifyJsonValue(projected)) return

  seedEntitySession(doc, {
    entityKind: 'dashboard_layout',
    payload: projected,
  })
}

async function readDefaultReferences(doc: Y.Doc) {
  const workspaceId = getEntityWorkspaceId(doc)
  return workspaceId ? readDefaultDashboardLayoutReferenceParams(workspaceId) : {}
}

function projectionInputSignature(fields: DashboardLayoutDocumentFields): string {
  return stableStringifyJsonValue({
    layout: layoutWidgetInputs(fields.layout),
    colorPairs: fields.colorPairs,
  })
}

function layoutWidgetInputs(node: LayoutNode): unknown {
  if (node.type === 'panel') {
    return widgetInput(node.widget)
  }
  return node.children.map(layoutWidgetInputs)
}

function widgetInput(widget: WidgetInstance): unknown {
  if (!widget) return null
  return {
    key: widget.key,
    pairColor: widget.pairColor,
    params: widget.params,
  }
}
