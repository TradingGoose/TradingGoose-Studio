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
    if (documentFormat && documentFormat !== TG_MERMAID_DOCUMENT_FORMAT) {
      throw new Error(`Unsupported workflow document format: ${documentFormat}`)
    }

    logger.info('Executing edit_workflow', {
      workflowId,
      documentFormat: documentFormat || TG_MERMAID_DOCUMENT_FORMAT,
      hasCurrentWorkflowState: !!currentWorkflowState,
    })

    const baseWorkflowState =
      parseCurrentWorkflowState(currentWorkflowState) ??
      (await getCurrentWorkflowStateFromDb(workflowId))

    const parsedWorkflowState = createWorkflowSnapshot(
      parseTgMermaidToWorkflow(workflowDocument)
    )
    const validation = validateWorkflowState(parsedWorkflowState, { sanitize: true })

    if (!validation.valid) {
      logger.error('Edited workflow state is invalid', {
        errors: validation.errors,
        warnings: validation.warnings,
      })
      throw new Error(`Invalid edited workflow: ${validation.errors.join('; ')}`)
    }

    const finalWorkflowState = createWorkflowSnapshot(
      (validation.sanitizedState as Partial<WorkflowSnapshot> | undefined) ?? parsedWorkflowState
    )
    const preview = buildWorkflowDocumentPreviewDiff(baseWorkflowState, finalWorkflowState)
    const combinedWarnings = [...preview.warnings, ...validation.warnings]

    logger.info('edit_workflow successfully parsed workflow document', {
      workflowId,
      blocksCount: Object.keys(finalWorkflowState.blocks).length,
      edgesCount: finalWorkflowState.edges.length,
      warningCount: combinedWarnings.length,
    })

    return {
      success: true,
      documentFormat: TG_MERMAID_DOCUMENT_FORMAT,
      workflowDocument: serializeWorkflowToTgMermaid(finalWorkflowState),
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
