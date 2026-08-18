/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatContext } from '@/stores/copilot/types'
import {
  GlobalCopilotContextProvider,
  GlobalCopilotContextPublisher,
  GlobalCopilotDashboardContextPublisher,
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

  const render = async (children: ReactNode) => {
    await act(async () => root.render(children))
  }

  const renderContexts = async (contexts: Array<ChatContext | null>) => {
    await render(
      <GlobalCopilotContextProvider>
        {contexts.map((context, index) => (
          <GlobalCopilotContextPublisher
            key={context ? `${context.kind}:${context.label}` : `empty:${index}`}
            context={context}
          />
        ))}
        <CurrentContextProbe />
      </GlobalCopilotContextProvider>
    )
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

    await renderContexts([monitorContext, null])
    expect(container.textContent).toBe('')

    await renderContexts([])
    expect(container.textContent).toBe('')
  })

  it('is inert when a page renders outside the authenticated workspace layout', async () => {
    await render(
      <GlobalCopilotContextPublisher
        context={{
          kind: 'current_logs',
          logId: 'log-1',
          workspaceId: 'workspace-1',
          label: 'Current log',
        }}
      />
    )

    expect(container.textContent).toBe('')
  })

  it('publishes only the active dashboard layout identity', async () => {
    await render(
      <GlobalCopilotContextProvider>
        <GlobalCopilotDashboardContextPublisher
          layoutId='layout-b'
          layoutName='Layout B'
          ownerUserId='user-1'
          workspaceId='workspace-1'
        />
        <CurrentContextProbe />
      </GlobalCopilotContextProvider>
    )
    expect(JSON.parse(container.textContent ?? '')).toEqual({
      kind: 'current_dashboard_layout',
      dashboardLayoutId: 'layout-b',
      workspaceId: 'workspace-1',
      ownerUserId: 'user-1',
      label: 'Layout B',
    })

    await render(
      <GlobalCopilotContextProvider>
        <GlobalCopilotDashboardContextPublisher
          layoutId={null}
          layoutName={null}
          ownerUserId='user-1'
          workspaceId='workspace-1'
        />
        <CurrentContextProbe />
      </GlobalCopilotContextProvider>
    )
    expect(container.textContent).toBe('')
  })
})
