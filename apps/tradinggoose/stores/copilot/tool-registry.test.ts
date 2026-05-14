import { afterEach, describe, expect, it } from 'vitest'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { unregisterClientTool } from '@/lib/copilot/tools/client/manager'
import {
  createExecutionContext,
  ensureClientToolInstance,
  getToolInterruptDisplays,
  isGatedTool,
  prepareCopilotToolArgs,
} from '@/stores/copilot/tool-registry'

describe('tool-registry', () => {
  const toolCallId = 'tool-registry-edit-workflow'

  afterEach(() => {
    unregisterClientTool(toolCallId)
  })

  it('does not block edit_workflow execution before staged review exists', () => {
    const instance = ensureClientToolInstance('edit_workflow', toolCallId)

    expect(instance).toBeDefined()
    expect(getToolInterruptDisplays('edit_workflow', toolCallId)).toBeUndefined()

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

    expect(getToolInterruptDisplays('edit_workflow', toolCallId)).toBeDefined()
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
  })

  it('does not inject workflow ids into server tool args from execution provenance', () => {
    const context = createExecutionContext({
      toolCallId,
      toolName: 'read_workflow_logs',
      provenance: { contextWorkflowId: 'wf-current' },
    })

    expect(context.contextWorkflowId).toBe('wf-current')
    expect(prepareCopilotToolArgs('read_workflow_logs', {}, context)).toEqual({})
    expect(
      prepareCopilotToolArgs(
        'read_workflow_logs',
        {},
        createExecutionContext({
          toolCallId,
          toolName: 'read_workflow_logs',
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
        { credentialId: 'credential-1', fileId: 'file-1', type: 'doc' },
        context
      )
    ).toEqual({ credentialId: 'credential-1', fileId: 'file-1', type: 'doc' })
  })

  it('classifies gated and non-gated tools explicitly', () => {
    expect(isGatedTool('make_api_request')).toBe(true)
    expect(isGatedTool('edit_workflow')).toBe(false)
    expect(isGatedTool('edit_workflow_block')).toBe(false)
    expect(isGatedTool('edit_skill')).toBe(false)
    expect(isGatedTool('edit_indicator')).toBe(false)
    expect(isGatedTool('edit_custom_tool')).toBe(false)
    expect(isGatedTool('edit_mcp_server')).toBe(false)
    expect(isGatedTool('checkoff_todo')).toBe(false)
    expect(isGatedTool('mark_todo_in_progress')).toBe(false)
    expect(isGatedTool('get_blocks_metadata')).toBe(false)
    expect(isGatedTool('get_agent_accessory_catalog')).toBe(false)
    expect(isGatedTool('unknown_integration_tool')).toBe(true)
  })
})
