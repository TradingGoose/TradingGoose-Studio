import { describe, expect, it } from 'vitest'
import {
  buildCopilotContextIdentityKey,
  isHiddenCopilotContext,
  mergeCopilotContexts,
} from './chat-contexts'

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

  it('hides all ambient page context variants from mention chips', () => {
    expect(isHiddenCopilotContext({ kind: 'current_knowledge_base' })).toBe(true)
    expect(isHiddenCopilotContext({ kind: 'current_logs' })).toBe(true)
    expect(isHiddenCopilotContext({ kind: 'current_monitor' })).toBe(true)
  })
})
