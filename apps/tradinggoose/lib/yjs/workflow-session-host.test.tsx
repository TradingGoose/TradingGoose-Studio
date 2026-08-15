/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
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
  acquireSharedWorkflowSession: () => () => {},
  subscribeToSharedWorkflowSession: () => () => {},
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
    const root = createRoot(container)
    const workflowADoc = new Y.Doc()
    const workflowBDoc = new Y.Doc()
    const renderSession = (workflowId: string) =>
      act(async () => {
        root.render(
          <WorkflowSessionProvider workspaceId='workspace-1' workflowId={workflowId}>
            <SessionProbe />
          </WorkflowSessionProvider>
        )
      })

    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    mocks.states.set('workflow-a', stateWithDoc(workflowADoc))
    mocks.states.set('workflow-b', stateWithDoc(workflowBDoc))

    try {
      await renderSession('workflow-a')
      expect(mocks.observations).toHaveBeenLastCalledWith({
        workflowId: 'workflow-a',
        doc: workflowADoc,
      })

      await renderSession('workflow-b')
      expect(mocks.observations).not.toHaveBeenCalledWith({
        workflowId: 'workflow-b',
        doc: workflowADoc,
      })
      expect(mocks.observations).toHaveBeenLastCalledWith({
        workflowId: 'workflow-b',
        doc: workflowBDoc,
      })
    } finally {
      act(() => root.unmount())
      workflowADoc.destroy()
      workflowBDoc.destroy()
      mocks.states.clear()
      reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    }
  })
})
