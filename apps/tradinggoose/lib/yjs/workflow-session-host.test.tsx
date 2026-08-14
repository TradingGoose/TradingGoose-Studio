/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
  useOptionalWorkflowSession,
  WorkflowSessionProvider,
} from '@/lib/yjs/workflow-session-host'
import type { SharedWorkflowSessionState } from '@/lib/yjs/workflow-shared-session'

const mocks = vi.hoisted(() => ({
  states: new Map<string, SharedWorkflowSessionState>(),
  listeners: new Map<string, Set<() => void>>(),
  observations: vi.fn(),
}))

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

vi.mock('@/lib/yjs/workflow-shared-session', () => {
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
    EMPTY_SHARED_WORKFLOW_SESSION_STATE: emptyState,
    getSharedWorkflowSessionState: (workflowId: string) =>
      mocks.states.get(workflowId) ?? emptyState,
    acquireSharedWorkflowSession: () => vi.fn(),
    subscribeToSharedWorkflowSession: (workflowId: string, listener: () => void) => {
      const listeners = mocks.listeners.get(workflowId) ?? new Set()
      listeners.add(listener)
      mocks.listeners.set(workflowId, listeners)
      return () => listeners.delete(listener)
    },
    setSharedWorkflowSessionUser: vi.fn(),
    undoSharedWorkflowSession: vi.fn(),
    redoSharedWorkflowSession: vi.fn(),
  }
})

function SessionProbe() {
  const session = useOptionalWorkflowSession()
  mocks.observations({ workflowId: session?.workflowId ?? null, doc: session?.doc ?? null })
  return null
}

describe('WorkflowSessionProvider', () => {
  let container: HTMLDivElement
  let root: Root
  let workflowADoc: Y.Doc
  let workflowBDoc: Y.Doc
  const reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }

  const stateWithDoc = (doc: Y.Doc): SharedWorkflowSessionState => ({
    doc,
    provider: null,
    awareness: null,
    canUndo: false,
    canRedo: false,
    isSynced: true,
    isLoading: false,
    error: null,
  })

  const renderSession = async (workflowId: string | null) => {
    await act(async () => {
      root.render(
        <WorkflowSessionProvider workspaceId='workspace-1' workflowId={workflowId}>
          <SessionProbe />
        </WorkflowSessionProvider>
      )
    })
  }

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    workflowADoc = new Y.Doc()
    workflowBDoc = new Y.Doc()
    mocks.states.clear()
    mocks.listeners.clear()
    mocks.observations.mockClear()
    mocks.states.set('workflow-a', stateWithDoc(workflowADoc))
    mocks.states.set('workflow-b', stateWithDoc(workflowBDoc))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    workflowADoc.destroy()
    workflowBDoc.destroy()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('never exposes the departed workflow document under a new workflow identity', async () => {
    await renderSession('workflow-a')
    expect(mocks.observations).toHaveBeenLastCalledWith({
      workflowId: 'workflow-a',
      doc: workflowADoc,
    })

    mocks.observations.mockClear()
    await renderSession('workflow-b')

    expect(mocks.observations).not.toHaveBeenCalledWith({
      workflowId: 'workflow-b',
      doc: workflowADoc,
    })
    expect(mocks.observations).toHaveBeenLastCalledWith({
      workflowId: 'workflow-b',
      doc: workflowBDoc,
    })
  })
})
