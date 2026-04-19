import { afterEach, describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { unregisterClientTool } from '@/lib/copilot/tools/client/manager'
import {
  copilotToolHasInterrupt,
  createExecutionContext,
  ensureClientToolInstance,
  getToolInterruptDisplays,
  prepareCopilotToolArgs,
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

  it('surfaces review interrupts for edit_workflow_block once staged', () => {
    const instance = ensureClientToolInstance('edit_workflow_block', toolCallId)

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

    expect(getToolInterruptDisplays('edit_workflow_block', toolCallId)).toBeDefined()
    expect(copilotToolHasInterrupt('edit_workflow_block', toolCallId)).toBe(true)
  })

  it('does not inject workflow ids into server tool args from execution provenance', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'get_workflow_console',
      provenance: { contextWorkflowId: 'wf-current' },
    })

    expect(context.contextWorkflowId).toBe('wf-current')
    expect(prepareCopilotToolArgs('get_workflow_console', {}, context)).toEqual({})
    expect(
      prepareCopilotToolArgs(
        'get_workflow_console',
        {},
        createExecutionContext({
          toolCallId,
          toolName: 'get_workflow_console',
          provenance: {
            workflowId: 'wf-1',
            contextWorkflowId: 'wf-current',
          },
        })
      )
    ).toEqual({})
  })

  it('preserves only explicit server-routed GDrive args', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_gdrive_file',
      provenance: { workflowId: 'wf-1' },
    })

    expect(
      prepareCopilotToolArgs(
        'read_gdrive_file',
        { fileId: 'file-1', type: 'doc' },
        context
      )
    ).toEqual({ fileId: 'file-1', type: 'doc' })
  })
})
