import { isToolId, type ToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import type { ServerToolExecutionContext } from '@/lib/copilot/tools/server/base-tool'
import {
  acceptCustomToolDocumentReview,
  acceptIndicatorDocumentReview,
  acceptMcpServerDocumentReview,
  acceptSkillDocumentReview,
  acceptWorkflowDocumentReview,
} from '@/lib/copilot/tools/server/entities'
import { acceptKnowledgeBaseDocumentReview } from '@/lib/copilot/tools/server/knowledge/knowledge-base'

export async function acceptServerManagedToolReview(
  toolName: string,
  reviewResult: unknown,
  context?: ServerToolExecutionContext
) {
  if (!isToolId(toolName)) {
    throw new Error(`Unknown server tool review: ${toolName}`)
  }

  const parsedResult = ToolResultSchemas[toolName].parse(reviewResult)
  switch (toolName as ToolId) {
    case 'edit_workflow':
    case 'edit_workflow_block':
    case 'edit_workflow_variable':
      return acceptWorkflowDocumentReview(toolName, parsedResult, context)
    case 'create_skill':
    case 'edit_skill':
    case 'rename_skill':
      return acceptSkillDocumentReview(toolName, parsedResult, context)
    case 'create_custom_tool':
    case 'edit_custom_tool':
    case 'rename_custom_tool':
      return acceptCustomToolDocumentReview(toolName, parsedResult, context)
    case 'create_indicator':
    case 'edit_indicator':
    case 'rename_indicator':
      return acceptIndicatorDocumentReview(toolName, parsedResult, context)
    case 'create_knowledge_base':
    case 'edit_knowledge_base':
    case 'rename_knowledge_base':
      return acceptKnowledgeBaseDocumentReview(toolName, parsedResult, context)
    case 'create_mcp_server':
    case 'edit_mcp_server':
    case 'rename_mcp_server':
      return acceptMcpServerDocumentReview(toolName, parsedResult, context)
    default:
      throw new Error(`Server tool ${toolName} does not support review acceptance`)
  }
}
