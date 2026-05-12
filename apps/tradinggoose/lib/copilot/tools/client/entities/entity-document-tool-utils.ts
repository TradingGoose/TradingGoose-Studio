import { getEntityDocumentName, type EntityDocumentKind } from '@/lib/copilot/entity-documents'
import { getDefaultIndicator } from '@/lib/indicators/default'
import type { ClientToolExecutionContext } from '@/lib/copilot/tools/client/base-tool'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import {
  getRegisteredEntitySession,
  getRegisteredEntitySessionByIdentity,
  registerEntitySession,
  unregisterEntitySession,
  type RegisteredEntitySession,
} from '@/lib/yjs/entity-session-registry'
import { bootstrapYjsProvider, type YjsProviderBootstrapResult } from '@/lib/yjs/provider'
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

type CopilotEntityYjsSessionLease = {
  session: RegisteredEntitySession
  release: () => void
}

const COPILOT_ENTITY_YJS_RELEASE_MS = 2_500

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

function parseCustomToolSchema(schemaText: unknown): Record<string, unknown> {
  if (typeof schemaText !== 'string') {
    throw new Error('custom tool schemaText is required')
  }

  const schema = JSON.parse(schemaText)
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('custom tool schemaText must be a JSON object')
  }

  return schema as Record<string, unknown>
}

function buildEntityCreateRequest(
  kind: EntityDocumentKind,
  workspaceId: string,
  fields: Record<string, unknown>
): { endpoint: string; body: Record<string, unknown> } {
  switch (kind) {
    case 'skill':
      return {
        endpoint: '/api/skills',
        body: {
          workspaceId,
          skills: [
            {
              name: fields.name,
              description: fields.description,
              content: fields.content,
            },
          ],
        },
      }
    case 'custom_tool':
      return {
        endpoint: '/api/tools/custom',
        body: {
          workspaceId,
          tools: [
            {
              title: fields.title,
              schema: parseCustomToolSchema(fields.schemaText),
              code: fields.codeText,
            },
          ],
        },
      }
    case 'indicator':
      return {
        endpoint: '/api/indicators/custom',
        body: {
          workspaceId,
          indicators: [
            {
              name: fields.name,
              ...(typeof fields.color === 'string' && fields.color.trim()
                ? { color: fields.color.trim() }
                : {}),
              pineCode: fields.pineCode,
              inputMeta: fields.inputMeta ?? undefined,
            },
          ],
        },
      }
    case 'mcp_server':
      return {
        endpoint: '/api/mcp/servers',
        body: {
          workspaceId,
          name: fields.name,
          ...(typeof fields.description === 'string' && fields.description.trim()
            ? { description: fields.description.trim() }
            : {}),
          transport: fields.transport,
          ...(typeof fields.url === 'string' && fields.url.trim() ? { url: fields.url.trim() } : {}),
          headers: fields.headers,
          ...(typeof fields.command === 'string' && fields.command.trim()
            ? { command: fields.command.trim() }
            : {}),
          args: fields.args,
          env: fields.env,
          timeout: fields.timeout,
          retries: fields.retries,
          enabled: fields.enabled,
        },
      }
  }
}

function readCreatedEntityId(kind: EntityDocumentKind, payload: any): string {
  if (kind === 'mcp_server') {
    const serverId = payload?.data?.serverId
    if (typeof serverId === 'string' && serverId.trim()) {
      return serverId
    }
    throw new Error('Created MCP server is missing serverId')
  }

  const created = Array.isArray(payload?.data) ? payload.data[0] : null
  const entityId = created?.id
  if (typeof entityId === 'string' && entityId.trim()) {
    return entityId
  }

  throw new Error(`Created ${kind} is missing id`)
}

export async function createCanonicalEntityFromFields(
  kind: EntityDocumentKind,
  workspaceId: string,
  fields: Record<string, unknown>
): Promise<{
  entityId: string
  entityName: string
  fields: Record<string, unknown>
}> {
  const request = buildEntityCreateRequest(kind, workspaceId, fields)
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload?.error || `Failed to create ${kind}: ${response.status}`)
  }

  const entityId = readCreatedEntityId(kind, payload)
  const createdRecord = kind === 'mcp_server' ? null : payload.data[0]
  const createdFields = createdRecord ? ENTITY_API_CONFIG[kind].toFields(createdRecord) : fields

  return {
    entityId,
    entityName: getEntityDocumentName(kind, createdFields),
    fields: createdFields,
  }
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
      (requestedEntityId
        ? session.descriptor.entityId === requestedEntityId
        : !!session.descriptor.entityId)

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

async function resolveEntityReviewSession(options: {
  workspaceId: string
  kind: EntityDocumentKind
  entityId?: string
  reviewSessionId?: string
}) {
  const response = await fetch('/api/copilot/review-sessions/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: options.workspaceId,
      entityKind: options.kind,
      entityId: options.entityId,
      reviewSessionId: options.reviewSessionId,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to resolve ${options.kind} review target`)
  }

  return payload as {
    descriptor: RegisteredEntitySession['descriptor']
    runtime: RegisteredEntitySession['runtime']
  }
}

function registerBootstrappedEntitySession(
  result: YjsProviderBootstrapResult
): CopilotEntityYjsSessionLease {
  const session: RegisteredEntitySession = {
    descriptor: result.descriptor,
    doc: result.doc,
    provider: result.provider,
    runtime: result.runtime,
    isSynced: false,
    canUndo: false,
    canRedo: false,
  }
  registerEntitySession(session)

  return {
    session,
    release: () => {
      setTimeout(() => {
        unregisterEntitySession(result.descriptor.reviewSessionId, result.doc)
        result.provider.disconnect()
        result.provider.destroy()
        result.doc.destroy()
      }, COPILOT_ENTITY_YJS_RELEASE_MS)
    },
  }
}

export async function resolveCopilotEntityYjsSessionLease(
  executionContext: ClientToolExecutionContext,
  kind: EntityDocumentKind,
  entityId?: string
): Promise<CopilotEntityYjsSessionLease> {
  const activeSession = getActiveEntitySession(executionContext, kind, entityId)
  if (activeSession) {
    return {
      session: activeSession,
      release: () => {},
    }
  }

  const requestedEntityId = entityId?.trim() || undefined
  const requestedReviewSessionId = executionContext.reviewSessionId

  if (!requestedEntityId && !requestedReviewSessionId) {
    throw new Error(`entityId is required to update a saved ${kind}`)
  }

  const workspaceId = resolveWorkspaceIdFromExecutionContext(executionContext)
  const resolved = await resolveEntityReviewSession({
    workspaceId,
    kind,
    entityId: requestedEntityId,
    reviewSessionId: requestedReviewSessionId,
  })

  const result = await bootstrapYjsProvider(resolved.descriptor)
  return registerBootstrappedEntitySession(result)
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
    throw new Error('entityId is required')
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
