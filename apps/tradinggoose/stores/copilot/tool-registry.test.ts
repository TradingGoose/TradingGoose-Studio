import { afterEach, describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { unregisterClientTool } from '@/lib/copilot/tools/client/manager'
import {
  copilotToolHasInterrupt,
  ensureClientToolInstance,
  getToolInterruptDisplays,
} from '@/stores/copilot/tool-registry'

describe('copilotToolHasInterrupt', () => {
  const toolCallId = 'tool-registry-edit-workflow'

  afterEach(() => {
    unregisterClientTool(toolCallId)
  })

  it('does not block edit_workflow execution before staged review exists', () => {
    const instance = ensureClientToolInstance('edit_workflow', toolCallId)

    expect(instance).toBeDefined()
    expect(copilotToolHasInterrupt('edit_workflow', toolCallId)).toBe(false)

    instance?.setState(ClientToolCallState.review, {
      result: {
        workflowState: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
      },
    })

    expect(copilotToolHasInterrupt('edit_workflow', toolCallId)).toBe(true)
  })

  it('rehydrates review interrupts from persisted workflow tool state', () => {
    const instance = ensureClientToolInstance('edit_workflow', toolCallId)

    instance?.hydratePersistedToolCall({
      id: toolCallId,
      name: 'edit_workflow',
      state: ClientToolCallState.review,
      result: {
        workflowState: {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        },
      },
    })

    expect(getToolInterruptDisplays('edit_workflow', toolCallId)).toBeDefined()
    expect(copilotToolHasInterrupt('edit_workflow', toolCallId)).toBe(true)
  })
})
