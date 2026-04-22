import { getEntityDocumentName, type EntityDocumentKind } from '@/lib/copilot/entity-documents'
import { getDefaultIndicator } from '@/lib/indicators/default'
import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  getRegisteredEntitySession,
  getRegisteredEntitySessionByIdentity,
  type RegisteredEntitySession,
} from '@/lib/yjs/entity-session-registry'
import {
  getEntityFields,
  replaceEntityTextField,
  setEntityField,
} from '@/lib/yjs/entity-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

type EntityListEntry = {
  entityId: string
  entityName: string
  entityDescription?: string
  entityTitle?: string
  entityFunctionName?: string
  entityColor?: string
  entityTransport?: string
  entityUrl?: string
  entityEnabled?: boolean
  entityConnectionStatus?: string
}

export type CopilotIndicatorListEntry = {
  name: string
  source: 'default' | 'custom'
  color?: string
  editable: boolean
  callableInFunctionBlock: boolean
  inputTitles?: string[]
  entityId?: string
  runtimeId?: string
}

export type EntityReadTarget = {
  entityId?: string
  runtimeId?: string
}

type EntityApiConfig = {
  listEndpoint: string
  extractList: (data: any) => any[]
  findById: (items: any[], entityId: string) => any | undefined
  toFields: (item: any) => Record<string, unknown>
  toListEntry: (item: any) => EntityListEntry
}

const ENTITY_API_CONFIG: Record<EntityDocumentKind, EntityApiConfig> = {
  skill: {
    listEndpoint: '/api/skills',
    extractList: (data) => (Array.isArray(data?.data) ? data.data : []),
    findById: (items, entityId) => items.find((item) => item?.id === entityId),
    toFields: (item) => ({
      name: item?.name ?? '',
      description: item?.description ?? '',
      content: item?.content ?? '',
    }),
    toListEntry: (item) => ({
      entityId: String(item?.id ?? ''),
      entityName: String(item?.name ?? ''),
      entityDescription: typeof item?.description === 'string' ? item.description : '',
    }),
  },
  custom_tool: {
    listEndpoint: '/api/tools/custom',
    extractList: (data) => (Array.isArray(data?.data) ? data.data : []),
    findById: (items, entityId) => items.find((item) => item?.id === entityId),
    toFields: (item) => ({
      title: item?.title ?? '',
      schemaText:
        item?.schema && typeof item.schema === 'object'
          ? JSON.stringify(item.schema, null, 2)
          : typeof item?.schemaText === 'string'
            ? item.schemaText
            : '',
      codeText: item?.code ?? item?.codeText ?? '',
    }),
    toListEntry: (item) => ({
      entityId: String(item?.id ?? ''),
      entityName: String(item?.title ?? item?.schema?.function?.name ?? ''),
      entityTitle: typeof item?.title === 'string' ? item.title : '',
      entityFunctionName:
        typeof item?.schema?.function?.name === 'string' ? item.schema.function.name : undefined,
      entityDescription:
        typeof item?.schema?.function?.description === 'string'
          ? item.schema.function.description
          : undefined,
    }),
  },
  indicator: {
    listEndpoint: '/api/indicators/custom',
    extractList: (data) => (Array.isArray(data?.data) ? data.data : []),
    findById: (items, entityId) => items.find((item) => item?.id === entityId),
    toFields: (item) => ({
      name: item?.name ?? '',
      color: item?.color ?? '',
      pineCode: item?.pineCode ?? '',
      inputMeta:
        item?.inputMeta && typeof item.inputMeta === 'object' && !Array.isArray(item.inputMeta)
          ? item.inputMeta
          : null,
    }),
    toListEntry: (item) => ({
      entityId: String(item?.id ?? ''),
      entityName: String(item?.name ?? ''),
      entityColor: typeof item?.color === 'string' ? item.color : '',
    }),
  },
  mcp_server: {
    listEndpoint: '/api/mcp/servers',
    extractList: (data) => (Array.isArray(data?.data?.servers) ? data.data.servers : []),
    findById: (items, entityId) => items.find((item) => item?.id === entityId),
    toFields: (item) => ({
      name: item?.name ?? '',
      description: item?.description ?? '',
      transport: item?.transport ?? 'http',
      url: item?.url ?? '',
      headers:
        item?.headers && typeof item.headers === 'object' && !Array.isArray(item.headers)
          ? item.headers
          : {},
      command: item?.command ?? '',
      args: Array.isArray(item?.args) ? item.args : [],
      env: item?.env && typeof item.env === 'object' && !Array.isArray(item.env) ? item.env : {},
      timeout: typeof item?.timeout === 'number' ? item.timeout : 30000,
      retries: typeof item?.retries === 'number' ? item.retries : 3,
      enabled: typeof item?.enabled === 'boolean' ? item.enabled : true,
    }),
    toListEntry: (item) => ({
      entityId: String(item?.id ?? ''),
      entityName: String(item?.name ?? ''),
      entityTransport: typeof item?.transport === 'string' ? item.transport : undefined,
      entityUrl: typeof item?.url === 'string' ? item.url : undefined,
      entityEnabled: typeof item?.enabled === 'boolean' ? item.enabled : undefined,
      entityConnectionStatus:
        typeof item?.connectionStatus === 'string' ? item.connectionStatus : undefined,
    }),
  },
}

export function resolveWorkspaceIdFromExecutionContext(
  executionContext: ClientToolExecutionContext
): string {
  if (executionContext.workspaceId) {
    return executionContext.workspaceId
  }

  if (executionContext.workflowId) {
    const workflow = useWorkflowRegistry.getState().workflows[executionContext.workflowId]
    if (workflow?.workspaceId) {
      return workflow.workspaceId
    }
  }

  throw new Error('No active workspace found')
}

export function getActiveEntitySession(
  executionContext: ClientToolExecutionContext,
  kind: EntityDocumentKind,
  entityId?: string
): RegisteredEntitySession | null {
  const requestedEntityId = entityId?.trim() || undefined
  const requestedReviewSessionId = executionContext.reviewSessionId
  const requestedDraftSessionId = executionContext.draftSessionId

  if (requestedReviewSessionId) {
    const session = getRegisteredEntitySession(requestedReviewSessionId)
    const matchesWorkspace =
      !executionContext.workspaceId ||
      !session?.descriptor.workspaceId ||
      session.descriptor.workspaceId === executionContext.workspaceId
    const matchesReviewSession =
      !!session &&
      session.descriptor.entityKind === kind &&
      matchesWorkspace &&
      (!requestedEntityId
        ? !session.descriptor.entityId
        : session.descriptor.entityId === requestedEntityId) &&
      (!requestedDraftSessionId || session.descriptor.draftSessionId === requestedDraftSessionId)

    if (matchesReviewSession) {
      return session
    }
  }

  return getRegisteredEntitySessionByIdentity(
    kind,
    requestedEntityId,
    executionContext.workspaceId ?? null
  )
}

async function fetchEntityList(kind: EntityDocumentKind, workspaceId: string): Promise<any[]> {
  const config = ENTITY_API_CONFIG[kind]
  const response = await fetch(
    `${config.listEndpoint}?workspaceId=${encodeURIComponent(workspaceId)}`
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data?.error || `Failed to fetch ${kind} entries: ${response.status}`)
  }

  return config.extractList(data)
}

export async function listCanonicalEntityEntries(
  kind: EntityDocumentKind,
  workspaceId: string
): Promise<EntityListEntry[]> {
  const config = ENTITY_API_CONFIG[kind]
  const items = await fetchEntityList(kind, workspaceId)
  return items.map((item) => config.toListEntry(item))
}

export async function listCopilotIndicators(
  workspaceId: string
): Promise<CopilotIndicatorListEntry[]> {
  const response = await fetch(
    `/api/indicators/options?workspaceId=${encodeURIComponent(workspaceId)}&surface=copilot`
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data?.error || `Failed to fetch indicators: ${response.status}`)
  }

  const items = Array.isArray(data?.data) ? data.data : []

  return items.flatMap((item: any) => {
    const name = typeof item?.name === 'string' ? item.name : ''
    const source = item?.source === 'custom' ? 'custom' : item?.source === 'default' ? 'default' : null
    if (!name || !source) return []

    const entry: CopilotIndicatorListEntry = {
      name,
      source,
      editable: item?.editable === true,
      callableInFunctionBlock: item?.callableInFunctionBlock === true,
      ...(typeof item?.color === 'string' && item.color ? { color: item.color } : {}),
      ...(Array.isArray(item?.inputTitles)
        ? {
            inputTitles: item.inputTitles.filter((value: unknown): value is string => typeof value === 'string'),
          }
        : {}),
      ...(typeof item?.entityId === 'string' && item.entityId ? { entityId: item.entityId } : {}),
      ...(typeof item?.runtimeId === 'string' && item.runtimeId ? { runtimeId: item.runtimeId } : {}),
    }

    return [entry]
  })
}

export async function readEntityFieldsFromContext(
  executionContext: ClientToolExecutionContext,
  kind: EntityDocumentKind,
  target?: EntityReadTarget
): Promise<{
  entityId?: string
  entityName: string
  fields: Record<string, unknown>
}> {
  const resolvedEntityId = target?.entityId?.trim() || undefined
  const resolvedRuntimeId = kind === 'indicator' ? target?.runtimeId?.trim() || undefined : undefined

  if (resolvedRuntimeId) {
    if (resolvedEntityId) {
      throw new Error('Use either runtimeId or entityId, not both')
    }

    const indicator = getDefaultIndicator(resolvedRuntimeId)
    if (!indicator) {
      throw new Error(`Built-in indicator ${resolvedRuntimeId} was not found`)
    }

    return {
      entityName: indicator.name,
      fields: {
        name: indicator.name,
        color: '#3972F6',
        pineCode: indicator.pineCode,
        inputMeta: indicator.inputMeta ?? null,
      },
    }
  }

  const activeSession = getActiveEntitySession(executionContext, kind, resolvedEntityId)

  if (activeSession) {
    const fields = getEntityFields(activeSession.doc, kind)
    return {
      entityId: activeSession.descriptor.entityId ?? resolvedEntityId,
      entityName: getEntityDocumentName(kind, fields),
      fields,
    }
  }

  if (!resolvedEntityId) {
    throw new Error('entityId is required unless an unsaved draft review session is active')
  }

  const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
  const config = ENTITY_API_CONFIG[kind]
  const items = await fetchEntityList(kind, workspaceId)
  const match = config.findById(items, resolvedEntityId)

  if (!match) {
    throw new Error(`Entity ${resolvedEntityId} was not found`)
  }

  const fields = config.toFields(match)
  return {
    entityId: resolvedEntityId,
    entityName: getEntityDocumentName(kind, fields),
    fields,
  }
}

export function applyEntityFieldsToSession(
  session: RegisteredEntitySession,
  kind: EntityDocumentKind,
  fields: Record<string, unknown>
): void {
  session.doc.transact(() => {
    switch (kind) {
      case 'skill':
        setEntityField(session.doc, 'name', fields.name ?? '')
        setEntityField(session.doc, 'description', fields.description ?? '')
        setEntityField(session.doc, 'content', fields.content ?? '')
        break
      case 'custom_tool':
        setEntityField(session.doc, 'title', fields.title ?? '')
        replaceEntityTextField(session.doc, 'schemaText', String(fields.schemaText ?? ''))
        replaceEntityTextField(session.doc, 'codeText', String(fields.codeText ?? ''))
        break
      case 'indicator':
        setEntityField(session.doc, 'name', fields.name ?? '')
        setEntityField(session.doc, 'color', fields.color ?? '')
        replaceEntityTextField(session.doc, 'pineCode', String(fields.pineCode ?? ''))
        setEntityField(session.doc, 'inputMeta', fields.inputMeta ?? null)
        break
      case 'mcp_server':
        setEntityField(session.doc, 'name', fields.name ?? '')
        setEntityField(session.doc, 'description', fields.description ?? '')
        setEntityField(session.doc, 'transport', fields.transport ?? 'http')
        setEntityField(session.doc, 'url', fields.url ?? '')
        setEntityField(session.doc, 'headers', fields.headers ?? {})
        setEntityField(session.doc, 'command', fields.command ?? '')
        setEntityField(session.doc, 'args', fields.args ?? [])
        setEntityField(session.doc, 'env', fields.env ?? {})
        setEntityField(session.doc, 'timeout', fields.timeout ?? 30000)
        setEntityField(session.doc, 'retries', fields.retries ?? 3)
        setEntityField(session.doc, 'enabled', fields.enabled ?? true)
        break
    }
  }, YJS_ORIGINS.COPILOT_TOOL)
}
