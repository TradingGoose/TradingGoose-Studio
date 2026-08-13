/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatContext } from '@/stores/copilot/types'
import {
  GlobalCopilotContextProvider,
  GlobalCopilotContextPublisher,
  resolveGlobalCopilotRouteContext,
  useGlobalCopilotCurrentContext,
} from './copilot-context'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

function CurrentContextProbe() {
  const context = useGlobalCopilotCurrentContext()
  return <div data-testid='current-context'>{context ? JSON.stringify(context) : ''}</div>
}

describe('global Copilot context', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  const renderContexts = async (contexts: ChatContext[]) => {
    await act(async () => {
      root.render(
        <GlobalCopilotContextProvider>
          {contexts.map((context) => (
            <GlobalCopilotContextPublisher
              key={`${context.kind}:${context.label}`}
              context={context}
            />
          ))}
          <CurrentContextProbe />
        </GlobalCopilotContextProvider>
      )
    })
  }

  it('publishes, replaces, and clears the active page context without stale cleanup', async () => {
    const logContext = {
      kind: 'current_logs' as const,
      logId: 'log-1',
      workspaceId: 'workspace-1',
      label: 'Current log',
    }
    const monitorContext = {
      kind: 'current_monitor' as const,
      monitorId: 'monitor-1',
      workspaceId: 'workspace-1',
      label: 'Current monitor',
    }

    await renderContexts([logContext, monitorContext])
    expect(container.textContent).toBe(JSON.stringify(monitorContext))

    await renderContexts([monitorContext])
    expect(container.textContent).toBe(JSON.stringify(monitorContext))

    await renderContexts([])
    expect(container.textContent).toBe('')
  })

  it('is inert when a page renders outside the authenticated workspace layout', async () => {
    await act(async () => {
      root.render(
        <GlobalCopilotContextPublisher
          context={{
            kind: 'current_logs',
            logId: 'log-1',
            workspaceId: 'workspace-1',
            label: 'Current log',
          }}
        />
      )
    })

    expect(container.textContent).toBe('')
  })

  it('resolves knowledge detail and document routes to their enclosing knowledge base', () => {
    const expected = {
      kind: 'current_knowledge_base',
      knowledgeBaseId: 'knowledge-1',
      workspaceId: 'workspace-1',
      label: 'Current knowledge base',
    }

    expect(
      resolveGlobalCopilotRouteContext(['workspace-1', 'knowledge', 'knowledge-1'], 'workspace-1')
    ).toEqual(expected)
    expect(
      resolveGlobalCopilotRouteContext(
        ['workspace-1', 'knowledge', 'knowledge-1', 'document-1'],
        'workspace-1'
      )
    ).toEqual(expected)
    expect(resolveGlobalCopilotRouteContext(['workspace-1', 'knowledge'], 'workspace-1')).toBeNull()
    expect(
      resolveGlobalCopilotRouteContext(['workspace-2', 'knowledge', 'knowledge-1'], 'workspace-1')
    ).toBeNull()
  })
})
