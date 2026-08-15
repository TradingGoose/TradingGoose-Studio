import { describe, expect, it } from 'vitest'
import {
  buildCopilotContextIdentityKey,
  isHiddenCopilotContext,
  mergeCopilotContexts,
} from './chat-contexts'
import { MAX_COPILOT_CONTEXTS_PER_TURN } from './context-limits'

describe('Copilot context identity', () => {
  it('deduplicates explicit and current knowledge through the shared entity identity', () => {
    const explicit = {
      kind: 'knowledge_base' as const,
      knowledgeBaseId: 'knowledge-1',
      workspaceId: 'workspace-1',
      label: 'Research',
    }
    const current = {
      ...explicit,
      kind: 'current_knowledge_base' as const,
      label: 'Current knowledge base',
    }

    expect(buildCopilotContextIdentityKey(explicit)).toBe('knowledge_base:knowledge-1')
    expect(
      mergeCopilotContexts({ explicitContexts: [explicit], implicitContexts: [current] })
    ).toEqual([explicit])
  })

  it('deduplicates attached and open logs by log id', () => {
    const explicit = {
      kind: 'logs' as const,
      logId: 'log-1',
      workspaceId: 'workspace-1',
      label: 'Run',
    }
    const current = {
      kind: 'current_logs' as const,
      logId: 'log-1',
      workspaceId: 'workspace-1',
      label: 'Current log',
    }

    expect(buildCopilotContextIdentityKey(current)).toBe('logs:workspace-1:log-1')
    expect(
      mergeCopilotContexts({ explicitContexts: [explicit], implicitContexts: [current] })
    ).toEqual([explicit])
  })

  it('hides ambient page contexts from mention chips', () => {
    expect(isHiddenCopilotContext({ kind: 'current_monitor' })).toBe(true)
  })

  it('caps deduplicated contexts with explicit mentions taking priority', () => {
    const explicit = Array.from({ length: MAX_COPILOT_CONTEXTS_PER_TURN }, (_, index) => ({
      kind: 'workflow' as const,
      workflowId: `workflow-${index}`,
      label: `Workflow ${index}`,
    }))
    const currentLog = {
      kind: 'current_logs' as const,
      logId: 'log-1',
      workspaceId: 'workspace-1',
      label: 'Current log',
    }

    expect(
      mergeCopilotContexts({ explicitContexts: explicit, implicitContexts: [currentLog] })
    ).toEqual(explicit)
    expect(
      mergeCopilotContexts({
        explicitContexts: explicit.slice(0, -1),
        implicitContexts: [explicit[0], currentLog],
      })
    ).toEqual([...explicit.slice(0, -1), currentLog])
  })
})
