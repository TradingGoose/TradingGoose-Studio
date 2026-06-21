import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { z } from 'zod'
import { getStableVibrantColor } from '@/lib/colors'
import { WORKFLOW_VARIABLE_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import { verifyWorkflowAccess } from '@/lib/copilot/review-sessions/permissions'
import { ENTITY_KIND_WORKFLOW, type ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { requireCopilotEntityId } from '@/lib/copilot/tools/entity-target'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  shouldStageServerToolMutationForReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { editWorkflowServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow'
import { editWorkflowBlockServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow-block'
import { VariableManager } from '@/lib/variables/variable-manager'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import {
  readWorkflowContainerBoundaryEdgeViolation,
  readWorkflowEdgeScope,
  serializeWorkflowToTgMermaid,
} from '@/lib/workflows/studio-workflow-mermaid'
import { isWorkflowVariableType, type WorkflowVariableType } from '@/lib/workflows/value-types'
import { applyWorkflowEntityName, applyWorkflowState } from '@/lib/yjs/server/apply-workflow-state'
import { readBootstrappedReviewTargetSnapshot } from '@/lib/yjs/server/bootstrap-review-target'
import {
  createWorkflowSnapshot,
  getVariablesSnapshot,
  readWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { requireUserId, verifyWorkspaceContext } from './shared'

type WorkflowSummary = {
  blocks: Array<{
    blockId: string
    blockType: string
    blockName: string
    enabled?: boolean
    parentId?: string
    subBlockIds: string[]
    connections: {
      externalIn: number
      externalOut: number
      internalIn: number
      internalOut: number
    }
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    scope: 'external' | 'internal'
  }>
  connectionIssues: Array<{
    edgeIndex: number
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    message: string
  }>
}

type WorkflowVariableDocumentEntry = {
  variableId?: string
  name: string
  type: WorkflowVariableType
  value?: unknown
}

const WorkflowVariableDocumentSchema = z
  .object({
    variables: z.array(
      z.object({
        variableId: z.string().trim().min(1).optional(),
        name: z.string().trim().min(1),
        type: z.string().trim().min(1),
        value: z.unknown().optional(),
      })
    ),
  })
  .strict()

function normalizeWorkflowName(value?: string | null): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function buildWorkflowDocumentEnvelope(input: {
  workflowId: string
  entityName?: string | null
  workspaceId?: string | null
  entityDocument: string
  documentFormat?: string
}) {
  const entityName = normalizeWorkflowName(input.entityName)

  return {
    entityKind: ENTITY_KIND_WORKFLOW,
    entityId: input.workflowId,
    ...(entityName ? { entityName } : {}),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    entityDocument: input.entityDocument,
    documentFormat: input.documentFormat ?? TG_MERMAID_DOCUMENT_FORMAT,
  }
}

function buildWorkflowSummary(workflowState: WorkflowSnapshot): WorkflowSummary {
  const edges: WorkflowSummary['edges'] = (workflowState.edges ?? []).map((edge) => ({
    source: edge.source,
    target: edge.target,
    ...(typeof edge.sourceHandle === 'string' ? { sourceHandle: edge.sourceHandle } : {}),
    ...(typeof edge.targetHandle === 'string' ? { targetHandle: edge.targetHandle } : {}),
    scope: readWorkflowEdgeScope(edge, workflowState.blocks ?? {}),
  }))
  const blockIds = Object.keys(workflowState.blocks ?? {}).sort()
  const connectionsByBlock = Object.fromEntries(
    blockIds.map((blockId) => [
      blockId,
      { externalIn: 0, externalOut: 0, internalIn: 0, internalOut: 0 },
    ])
  )

  edges.forEach((edge) => {
    const prefix = edge.scope === 'internal' ? 'internal' : 'external'
    if (connectionsByBlock[edge.source]) {
      connectionsByBlock[edge.source][`${prefix}Out`] += 1
    }
    if (connectionsByBlock[edge.target]) {
      connectionsByBlock[edge.target][`${prefix}In`] += 1
    }
  })

  return {
    blocks: blockIds.map((blockId) => {
      const block = workflowState.blocks[blockId]

      return {
        blockId,
        blockType: block.type,
        blockName:
          normalizeWorkflowName(typeof block.name === 'string' ? block.name : undefined) ?? blockId,
        ...(typeof block.enabled === 'boolean' ? { enabled: block.enabled } : {}),
        ...(typeof block.data?.parentId === 'string' ? { parentId: block.data.parentId } : {}),
        subBlockIds: Object.keys(block.subBlocks ?? {}).sort(),
        connections: connectionsByBlock[blockId],
      }
    }),
    edges,
    connectionIssues: edges.flatMap((edge, edgeIndex) => {
      const message = readWorkflowContainerBoundaryEdgeViolation(edge, workflowState.blocks ?? {})
      const { scope: _scope, ...edgeWithoutScope } = edge
      return message ? [{ edgeIndex, ...edgeWithoutScope, message }] : []
    }),
  }
}

async function verifyWorkflowContext(
  workflowId: string,
  context: ServerToolExecutionContext | undefined,
  accessMode: ReviewAccessMode
) {
  const userId = requireUserId(context)
  const access = await verifyWorkflowAccess(userId, workflowId, accessMode)
  if (!access.hasAccess) {
    throw new Error(
      `Access denied: You do not have permission to ${accessMode === 'write' ? 'edit' : 'read'} this workflow`
    )
  }

  return { userId, workspaceId: access.workspaceId }
}

export async function loadWorkflowSnapshotForCopilot(
  workflowId: string,
  context: ServerToolExecutionContext | undefined,
  accessMode: ReviewAccessMode
): Promise<{
  workflowId: string
  entityName?: string
  workspaceId: string | null
  workflowState: WorkflowSnapshot
  variables: Record<string, any>
}> {
  const { workspaceId } = await verifyWorkflowContext(workflowId, context, accessMode)
  const [workflowRow] = await db
    .select({
      id: workflow.id,
      name: workflow.name,
      workspaceId: workflow.workspaceId,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRow) {
    throw new Error('Workflow not found')
  }

  const snapshot = await readBootstrappedReviewTargetSnapshot({
    workspaceId: workspaceId ?? workflowRow.workspaceId,
    entityKind: ENTITY_KIND_WORKFLOW,
    entityId: workflowId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: workflowId,
  })

  if (!snapshot.snapshotBase64) {
    throw new Error(`Current Yjs workflow state is required for ${workflowId}`)
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    return {
      workflowId,
      entityName: workflowRow.name ?? undefined,
      workspaceId: workflowRow.workspaceId ?? null,
      workflowState: readWorkflowSnapshot(doc),
      variables: getVariablesSnapshot(doc),
    }
  } finally {
    doc.destroy()
  }
}

function serializeWorkflowVariableDocument(variables: Record<string, any>): string {
  const entries = Object.values(variables)
    .filter((variable: any) => variable && typeof variable === 'object')
    .map((variable: any) => ({
      variableId: String(variable.id ?? ''),
      name: String(variable.name ?? ''),
      type: isWorkflowVariableType(variable.type) ? variable.type : 'plain',
      value: variable.value ?? '',
    }))
    .filter((variable) => variable.name.trim().length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))

  return JSON.stringify({ variables: entries }, null, 2)
}

function parseWorkflowVariableDocument(entityDocument: string): WorkflowVariableDocumentEntry[] {
  const parsed = WorkflowVariableDocumentSchema.parse(JSON.parse(entityDocument))
  const seenNames = new Set<string>()
  const seenVariableIds = new Set<string>()

  return parsed.variables.map((variable) => {
    const variableId = variable.variableId?.trim()
    if (variableId) {
      if (seenVariableIds.has(variableId)) {
        throw new Error(`Duplicate workflow variableId: ${variableId}`)
      }
      seenVariableIds.add(variableId)
    }

    const name = variable.name.trim()
    if (seenNames.has(name)) {
      throw new Error(`Duplicate workflow variable name: ${name}`)
    }
    seenNames.add(name)

    if (!isWorkflowVariableType(variable.type)) {
      throw new Error(`Unsupported workflow variable type: ${variable.type}`)
    }

    return {
      ...(variableId ? { variableId } : {}),
      name,
      type: variable.type,
      value: variable.value,
    }
  })
}

function normalizeWorkflowVariableValue(value: unknown, type: WorkflowVariableType): unknown {
  if (value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return VariableManager.parseInputForStorage(value, type)
  }
  if (type === 'plain') {
    return String(value ?? '')
  }
  return VariableManager.parseInputForStorage(JSON.stringify(value), type)
}

function buildWorkflowVariablesFromDocument(input: {
  workflowId: string
  entityDocument: string
}): Record<string, any> {
  const entries = parseWorkflowVariableDocument(input.entityDocument)

  return Object.fromEntries(
    entries.map((entry) => {
      const id = entry.variableId ?? crypto.randomUUID()
      return [
        id,
        {
          id,
          workflowId: input.workflowId,
          name: entry.name,
          type: entry.type,
          value: normalizeWorkflowVariableValue(entry.value, entry.type),
        },
      ]
    })
  )
}

export const listWorkflowsServerTool: BaseServerTool<{ workspaceId?: string }, any> = {
  name: 'list_workflows',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const rows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        workspaceId: workflow.workspaceId,
        description: workflow.description,
      })
      .from(workflow)
      .where(eq(workflow.workspaceId, workspaceId))

    return {
      entityKind: ENTITY_KIND_WORKFLOW,
      entities: rows.map((row) => ({
        entityId: row.id,
        ...(row.name ? { entityName: row.name } : {}),
        ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
        ...(row.description ? { entityDescription: row.description } : {}),
      })),
      count: rows.length,
    }
  },
}

export const readWorkflowServerTool: BaseServerTool<{ entityId: string }, any> = {
  name: 'read_workflow',
  async execute(args, context) {
    const workflowId = requireCopilotEntityId(args, { toolName: 'read_workflow' })
    const { entityName, workspaceId, workflowState, variables } =
      await loadWorkflowSnapshotForCopilot(workflowId, context, 'read')
    const entityDocument = serializeWorkflowToTgMermaid(workflowState)

    return {
      ...buildWorkflowDocumentEnvelope({
        workflowId,
        entityName,
        workspaceId,
        entityDocument,
      }),
      workflowSummary: buildWorkflowSummary(workflowState),
      workflowVariableDocumentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
      workflowVariableDocument: serializeWorkflowVariableDocument(variables),
    }
  },
}

export const editWorkflowVariableServerTool: BaseServerTool<
  { entityId: string; entityDocument: string; documentFormat?: string },
  any
> = {
  name: 'edit_workflow_variable',
  async execute(args, context) {
    if (args.documentFormat && args.documentFormat !== WORKFLOW_VARIABLE_DOCUMENT_FORMAT) {
      throw new Error(
        `Unsupported documentFormat "${args.documentFormat}". Expected ${WORKFLOW_VARIABLE_DOCUMENT_FORMAT}`
      )
    }
    const workflowId = requireCopilotEntityId(args, { toolName: 'edit_workflow_variable' })
    const { workspaceId, workflowState, variables } = await loadWorkflowSnapshotForCopilot(
      workflowId,
      context,
      'write'
    )
    const nextVariables = buildWorkflowVariablesFromDocument({
      workflowId,
      entityDocument: args.entityDocument,
    })
    const nextDocument = serializeWorkflowVariableDocument(nextVariables)

    if (shouldStageServerToolMutationForReview(context)) {
      const currentDocument = serializeWorkflowVariableDocument(variables)
      return {
        requiresReview: true,
        success: true,
        entityKind: ENTITY_KIND_WORKFLOW,
        entityId: workflowId,
        ...(workspaceId ? { workspaceId } : {}),
        documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
        entityDocument: nextDocument,
        variables: nextVariables,
        preview: {
          documentDiff: {
            before: currentDocument,
            after: nextDocument,
          },
        },
      }
    }

    await applyWorkflowState(workflowId, workflowState, nextVariables)
    return {
      success: true,
      entityKind: ENTITY_KIND_WORKFLOW,
      entityId: workflowId,
      ...(workspaceId ? { workspaceId } : {}),
      documentFormat: WORKFLOW_VARIABLE_DOCUMENT_FORMAT,
      entityDocument: nextDocument,
      variables: nextVariables,
    }
  },
}

export const createWorkflowServerTool: BaseServerTool<
  { name?: string; description?: string; folderId?: string | null; workspaceId?: string },
  any
> = {
  name: 'create_workflow',
  async execute(args, context) {
    const explicitWorkspaceId = args.workspaceId?.trim()
    const contextWorkspaceId = context?.workspaceId?.trim()
    const authenticatedUserId = requireUserId(context)
    const { userId, workspaceId } = await verifyWorkspaceContext(
      {
        ...context,
        userId: authenticatedUserId,
        workspaceId: explicitWorkspaceId || contextWorkspaceId,
      },
      'write'
    )
    const workflowId = crypto.randomUUID()
    const now = new Date()
    const name = args.name?.trim() || 'New workflow'
    const description = typeof args.description === 'string' ? args.description : 'New workflow'
    const color = getStableVibrantColor(workflowId)
    const workflowState = createWorkflowSnapshot()

    if (shouldStageServerToolMutationForReview(context)) {
      return {
        requiresReview: true,
        success: true,
        entityKind: ENTITY_KIND_WORKFLOW,
        entityId: workflowId,
        entityName: name,
        workspaceId,
        reviewBaseStateHash: workspaceId,
      }
    }

    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      folderId: args.folderId || null,
      name,
      description,
      color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      collaborators: [],
      runCount: 0,
      variables: {},
      isPublished: false,
      marketplaceData: null,
    })

    try {
      await applyWorkflowState(workflowId, workflowState, {}, name)
    } catch (error) {
      await db.delete(workflow).where(eq(workflow.id, workflowId))
      throw error
    }

    return {
      success: true,
      entityKind: ENTITY_KIND_WORKFLOW,
      entityId: workflowId,
      entityName: name,
      workspaceId,
    }
  },
}

export const renameWorkflowServerTool: BaseServerTool<{ entityId: string; name: string }, any> = {
  name: 'rename_workflow',
  async execute(args, context) {
    const workflowId = requireCopilotEntityId(args, { toolName: 'rename_workflow' })
    const nextName = args.name?.trim()
    if (!nextName) {
      throw new Error('name is required')
    }

    const current = await loadWorkflowSnapshotForCopilot(workflowId, context, 'write')
    if (shouldStageServerToolMutationForReview(context)) {
      return {
        requiresReview: true,
        success: true,
        entityKind: ENTITY_KIND_WORKFLOW,
        entityId: workflowId,
        entityName: nextName,
        workspaceId: current.workspaceId ?? undefined,
        reviewBaseStateHash: `${workflowId}:${current.entityName ?? ''}`,
      }
    }

    const updatedWorkflow = await applyWorkflowEntityName(
      workflowId,
      current.workflowState,
      current.variables,
      nextName
    )

    return {
      success: true,
      entityKind: ENTITY_KIND_WORKFLOW,
      entityId: workflowId,
      entityName: nextName,
      workspaceId: updatedWorkflow.workspaceId ?? current.workspaceId ?? undefined,
    }
  },
}

export { editWorkflowServerTool, editWorkflowBlockServerTool }
