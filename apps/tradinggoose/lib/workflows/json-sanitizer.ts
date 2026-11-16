import type { Edge } from '@xyflow/react'
import type { Variable } from '@/stores/variables/types'
import type { BlockState, Loop, Parallel, WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Export workflow state (includes positions but removes secrets)
 */
export interface ExportWorkflowState {
  version: string
  exportedAt: string
  state: {
    blocks: Record<string, BlockState>
    edges: Edge[]
    loops: Record<string, Loop>
    parallels: Record<string, Parallel>
    variables: Record<string, Variable>
  }
}

/**
 * Sanitize workflow state for export by removing secrets but keeping positions
 * Users need positions to restore the visual layout when importing
 */
export function sanitizeForExport(
  state: WorkflowState & { variables?: Record<string, Variable> }
): ExportWorkflowState {
  // Deep clone to avoid mutating original state
  const clonedState = JSON.parse(
    JSON.stringify({
      blocks: state.blocks,
      edges: state.edges,
      loops: state.loops || {},
      parallels: state.parallels || {},
      variables: state.variables || {},
    })
  )

  // Remove sensitive data from subblocks
  Object.values(clonedState.blocks).forEach((block: any) => {
    if (block.subBlocks) {
      Object.entries(block.subBlocks).forEach(([key, subBlock]: [string, any]) => {
        // Clear OAuth credentials and API keys based on field name only
        if (
          /credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key) ||
          subBlock.type === 'oauth-input'
        ) {
          subBlock.value = ''
        }
        // Remove knowledge base tag filters and document tags (workspace-specific data)
        if (key === 'tagFilters' || key === 'documentTags') {
          subBlock.value = ''
        }
      })
    }

    // Also clear from data field if present
    if (block.data) {
      Object.entries(block.data).forEach(([key, value]: [string, any]) => {
        if (/credential|oauth|api[_-]?key|token|secret|auth|password|bearer/i.test(key)) {
          block.data[key] = ''
        }
      })
    }
  })

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    state: clonedState,
  }
}
