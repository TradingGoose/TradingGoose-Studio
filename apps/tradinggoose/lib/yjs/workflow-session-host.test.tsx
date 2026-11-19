/**
 * @vitest-environment jsdom
 */

import { act, StrictMode } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  useOptionalWorkflowSession,
  WorkflowSessionProvider,
} from '@/lib/yjs/workflow-session-host'
import type { SharedWorkflowSessionState } from '@/lib/yjs/workflow-shared-session'

const mocks = vi.hoisted(() => {
  const emptyState: SharedWorkflowSessionState = {
    doc: null,
    provider: null,
    awareness: null,
    canUndo: false,
    canRedo: false,
    isSynced: false,
    isLoading: true,
    error: null,
  }
  return {
    emptyState,
    states: new Map<string, SharedWorkflowSessionState>(),
    subscriptions: new Map<string, () => void>(),
    observations: vi.fn(),
  }
})

vi.mock('@/app/workspace/[workspaceId]/providers/workspace-permissions-provider', () => ({
  useUserPermissionsContext: () => ({ canEdit: true, isLoading: false }),
}))

vi.mock('@/lib/yjs/use-entity-fields', () => ({
  useYjsTargetSession: () => ({
    result: null,
    doc: null,
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/lib/yjs/workflow-shared-session', () => ({
  EMPTY_SHARED_WORKFLOW_SESSION_STATE: mocks.emptyState,
  getSharedWorkflowSessionState: (workflowId: string) =>
    mocks.states.get(workflowId) ?? mocks.emptyState,
  acquireSharedWorkflowSession: ({ workflowId }: { workflowId: string }, notify: () => void) => {
    mocks.subscriptions.set(workflowId, notify)
    return () => mocks.subscriptions.delete(workflowId)
  },
  setSharedWorkflowSessionUser: vi.fn(),
  undoSharedWorkflowSession: vi.fn(),
  redoSharedWorkflowSession: vi.fn(),
}))

function SessionProbe() {
  const session = useOptionalWorkflowSession()
  mocks.observations({ workflowId: session?.workflowId ?? null, doc: session?.doc ?? null })
  return null
}

const stateWithDoc = (doc: Y.Doc): SharedWorkflowSessionState => ({
  ...mocks.emptyState,
  doc,
  isSynced: true,
  isLoading: false,
})

describe('WorkflowSessionProvider', () => {
  it('never exposes the departed workflow document under a new workflow identity', async () => {
    const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const container = document.createElement('div')
    let root: Root | undefined
    const workflowADoc = new Y.Doc()
    const workflowBDoc = new Y.Doc()
    const session = (workflowId: string) => (
      <StrictMode>
        <WorkflowSessionProvider workspaceId='workspace-1' workflowId={workflowId}>
          <SessionProbe />
        </WorkflowSessionProvider>
      </StrictMode>
    )

    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.states.set('workflow-a', stateWithDoc(workflowADoc))
    mocks.states.set('workflow-b', stateWithDoc(workflowBDoc))

    try {
      container.innerHTML = renderToString(session('workflow-a'))
      expect(mocks.observations).toHaveBeenLastCalledWith({ workflowId: 'workflow-a', doc: null })
      await act(async () => {
        root = hydrateRoot(container, session('workflow-a'))
      })
      expect(mocks.observations).toHaveBeenLastCalledWith({
        workflowId: 'workflow-a',
        doc: workflowADoc,
      })

      await act(async () => root!.render(session('workflow-b')))
      expect([...mocks.subscriptions.keys()]).toEqual(['workflow-b'])
      expect(mocks.observations).not.toHaveBeenCalledWith({
        workflowId: 'workflow-b',
        doc: workflowADoc,
      })
      expect(mocks.observations).toHaveBeenLastCalledWith({
        workflowId: 'workflow-b',
        doc: workflowBDoc,
      })
      mocks.states.delete('workflow-b')
      await act(async () => mocks.subscriptions.get('workflow-b')!())
      expect(mocks.observations).toHaveBeenLastCalledWith({ workflowId: 'workflow-b', doc: null })
    } finally {
      act(() => root?.unmount())
      expect(mocks.subscriptions.size).toBe(0)
      workflowADoc.destroy()
      workflowBDoc.destroy()
      mocks.states.clear()
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    }
  })
})
