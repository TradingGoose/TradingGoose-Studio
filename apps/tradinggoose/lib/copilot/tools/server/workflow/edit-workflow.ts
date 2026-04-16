import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import {
  buildWorkflowDocumentPreviewDiff,
  parseTgMermaidToWorkflow,
  serializeWorkflowToTgMermaid,
  TG_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/studio-workflow-mermaid'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { normalizeWorkflowStateToMermaidDirection } from '@/lib/workflows/workflow-direction'

interface EditWorkflowParams {
  workflowId: string
  workflowDocument: string
  documentFormat?: string
  currentWorkflowState?: string
}

async function getCurrentWorkflowStateFromDb(workflowId: string): Promise<WorkflowSnapshot> {
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new Error(`Workflow ${workflowId} not found in database`)
  }

  return createWorkflowSnapshot({
    blocks: normalized.blocks || {},
    edges: normalized.edges || [],
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  })
}

function parseCurrentWorkflowState(currentWorkflowState?: string): WorkflowSnapshot | undefined {
  if (!currentWorkflowState) {
    return undefined
  }

  try {
    return createWorkflowSnapshot(JSON.parse(currentWorkflowState))
  } catch {
    throw new Error('Invalid currentWorkflowState format')
  }
}

export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, any> = {
  name: 'edit_workflow',
  async execute(params: EditWorkflowParams): Promise<any> {
    const logger = createLogger('EditWorkflowServerTool')
    const { workflowId, workflowDocument, documentFormat, currentWorkflowState } = params

    if (!workflowId) {
      throw new Error('workflowId is required')
    }
    if (!workflowDocument || workflowDocument.trim().length === 0) {
      throw new Error('workflowDocument is required')
    }

    logger.info('Executing edit_workflow', {
      workflowId,
      documentFormat: documentFormat || TG_MERMAID_DOCUMENT_FORMAT,
      hasCurrentWorkflowState: !!currentWorkflowState,
    })

    const baseWorkflowState =
      parseCurrentWorkflowState(currentWorkflowState) ??
      (await getCurrentWorkflowStateFromDb(workflowId))

    const parsedWorkflowDocument = parseTgMermaidToWorkflow(workflowDocument)
    const requestedDirection = parsedWorkflowDocument.direction
    const parsedWorkflowState = createWorkflowSnapshot(parsedWorkflowDocument)
    const validation = validateWorkflowState(parsedWorkflowState, { sanitize: true })

    if (!validation.valid) {
      logger.error('Edited workflow state is invalid', {
        errors: validation.errors,
        warnings: validation.warnings,
      })
      throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
    }

    let finalWorkflowState = createWorkflowSnapshot(
      (validation.sanitizedState as Partial<WorkflowSnapshot> | undefined) ?? parsedWorkflowState
    )
    const orientationWarnings: string[] = []
    const normalizedWorkflow = normalizeWorkflowStateToMermaidDirection(
      finalWorkflowState,
      requestedDirection
    )

    if (normalizedWorkflow.didRelayout) {
      finalWorkflowState = createWorkflowSnapshot(normalizedWorkflow.workflowState)
      orientationWarnings.push(
        `Re-laid out workflow blocks to match Mermaid direction ${requestedDirection}.`
      )
    } else {
      finalWorkflowState = createWorkflowSnapshot(normalizedWorkflow.workflowState)
    }
    const preview = buildWorkflowDocumentPreviewDiff(baseWorkflowState, finalWorkflowState)
    const combinedWarnings = [...orientationWarnings, ...preview.warnings, ...validation.warnings]

    logger.info('edit_workflow successfully parsed workflow document', {
      workflowId,
      blocksCount: Object.keys(finalWorkflowState.blocks).length,
      edgesCount: finalWorkflowState.edges.length,
      warningCount: combinedWarnings.length,
    })

    const nextWorkflowDocument = serializeWorkflowToTgMermaid(finalWorkflowState, {
      direction: requestedDirection,
    })

    return {
      success: true,
      entityKind: 'workflow',
      entityId: workflowId,
      entityDocument: nextWorkflowDocument,
      workflowId,
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
      workflowDocument: nextWorkflowDocument,
      workflowState: finalWorkflowState,
      preview: {
        ...preview,
        warnings: Array.from(new Set(combinedWarnings)),
      },
      data: {
        blocksCount: Object.keys(finalWorkflowState.blocks || {}).length,
        edgesCount: Array.isArray(finalWorkflowState.edges) ? finalWorkflowState.edges.length : 0,
      },
    }
  },
}
