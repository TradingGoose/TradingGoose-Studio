import { createWorkflowExecutionTerminalEventInput } from '@/lib/workflows/execution-events'
import { isExecutionResult } from '@/lib/workflows/execution-result'
import { ClientToolCallState } from '../base-tool'

/** The Studio readback envelope is shared by live tool results and native history. */
export function workflowReadback(tool: string, value: unknown) {
  if (
    tool !== 'run_workflow' ||
    !value ||
    typeof value !== 'object' ||
    !('data' in value) ||
    !isExecutionResult(value.data) ||
    !('message' in value) ||
    typeof value.message !== 'string' ||
    !('executionId' in value) ||
    typeof value.executionId !== 'string'
  )
    return
  const event = createWorkflowExecutionTerminalEventInput(value.data)
  return {
    executionId: value.executionId,
    data: value.data,
    message: value.message,
    state:
      event.type === 'execution:cancelled'
        ? ClientToolCallState.aborted
        : event.type === 'execution:error'
          ? ClientToolCallState.error
          : ClientToolCallState.success,
  }
}
