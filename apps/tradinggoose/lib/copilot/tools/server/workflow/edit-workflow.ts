import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { createLogger } from '@/lib/logs/console/logger'
import {
  parseTgMermaidToWorkflow,
  TG_MERMAID_DOCUMENT_FORMAT,
} from '@/lib/workflows/studio-workflow-mermaid'
import { createWorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  buildWorkflowMutationResult,
  loadBaseWorkflowState,
} from './workflow-mutation-utils'

interface EditWorkflowParams {
  workflowId: string
  workflowDocument: string
  documentFormat?: string
  currentWorkflowState?: string
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

    const baseWorkflowState = await loadBaseWorkflowState(workflowId, currentWorkflowState)
    const parsedWorkflowDocument = parseTgMermaidToWorkflow(workflowDocument)
    const result = buildWorkflowMutationResult({
      workflowId,
      baseWorkflowState,
      nextWorkflowState: createWorkflowSnapshot(parsedWorkflowDocument),
      requestedDirection: parsedWorkflowDocument.direction,
    })

    logger.info('edit_workflow successfully parsed workflow document', {
      workflowId,
      blocksCount: Object.keys(result.workflowState.blocks).length,
      edgesCount: result.workflowState.edges.length,
      warningCount: result.preview?.warnings.length ?? 0,
    })

    return result
  },
}
