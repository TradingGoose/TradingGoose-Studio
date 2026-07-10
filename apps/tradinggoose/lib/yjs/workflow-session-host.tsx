'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import type * as Y from 'yjs'
import type { ReviewAccessMode } from '@/lib/copilot/review-sessions/types'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { readWorkflowSnapshotCloned, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  acquireSharedWorkflowSession,
  EMPTY_SHARED_WORKFLOW_SESSION_STATE,
  getSharedWorkflowSessionState,
  redoSharedWorkflowSession,
  type SharedWorkflowSessionState,
  setSharedWorkflowSessionUser,
  subscribeToSharedWorkflowSession,
  undoSharedWorkflowSession,
} from '@/lib/yjs/workflow-shared-session'

export interface WorkflowSessionContextValue {
  workflowId: string
  accessMode: ReviewAccessMode
  doc: Y.Doc | null
  awareness: SharedWorkflowSessionState['awareness']
  isSynced: boolean
  isLoading: boolean
  error: string | null
  readWorkflowSnapshot: () => WorkflowSnapshot | null
  transactWorkflow: (fn: (doc: Y.Doc) => void, origin?: string) => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}

const WorkflowSessionContext = createContext<WorkflowSessionContextValue | null>(null)

export function useWorkflowSession(): WorkflowSessionContextValue {
  const ctx = useContext(WorkflowSessionContext)
  if (!ctx) {
    throw new Error('useWorkflowSession must be used within a WorkflowSessionProvider')
  }
  return ctx
}

export function useOptionalWorkflowSession(): WorkflowSessionContextValue | null {
  return useContext(WorkflowSessionContext)
}

export interface WorkflowSessionUser {
  id: string
  name?: string
  email?: string
}

interface WorkflowSessionProviderProps {
  workspaceId: string | null
  workflowId: string
  accessMode: ReviewAccessMode
  user?: WorkflowSessionUser
  children: ReactNode
}

export function WorkflowSessionProvider({
  workspaceId,
  workflowId,
  accessMode,
  user,
  children,
}: WorkflowSessionProviderProps) {
  const [state, setState] = useState<SharedWorkflowSessionState>(() =>
    workflowId
      ? getSharedWorkflowSessionState(workflowId, accessMode)
      : { ...EMPTY_SHARED_WORKFLOW_SESSION_STATE }
  )
  const { doc, awareness, isSynced, isLoading, error, canUndo, canRedo } = state

  useEffect(() => {
    if (!workflowId) {
      setState({ ...EMPTY_SHARED_WORKFLOW_SESSION_STATE })
      return
    }

    const syncState = () => {
      setState(getSharedWorkflowSessionState(workflowId, accessMode))
    }

    syncState()
    const release = acquireSharedWorkflowSession({
      workflowId,
      workspaceId,
      accessMode,
    })
    const unsubscribe = subscribeToSharedWorkflowSession(workflowId, accessMode, syncState)
    syncState()

    return () => {
      unsubscribe()
      release()
      setState({ ...EMPTY_SHARED_WORKFLOW_SESSION_STATE })
    }
  }, [accessMode, workflowId, workspaceId])

  useEffect(() => {
    setSharedWorkflowSessionUser(workflowId, accessMode, user)
  }, [accessMode, awareness, workflowId, user])

  const getSnapshot = useCallback((): WorkflowSnapshot | null => {
    if (!doc) return null
    return readWorkflowSnapshotCloned(doc)
  }, [doc])

  const transactWorkflow = useCallback(
    (fn: (d: Y.Doc) => void, origin?: string) => {
      if (!doc || accessMode !== 'write') return
      doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER)
    },
    [accessMode, doc]
  )

  const undo = useCallback(() => {
    undoSharedWorkflowSession(workflowId, accessMode)
  }, [accessMode, workflowId])

  const redo = useCallback(() => {
    redoSharedWorkflowSession(workflowId, accessMode)
  }, [accessMode, workflowId])

  const value: WorkflowSessionContextValue = {
    workflowId,
    accessMode,
    doc,
    awareness,
    isSynced,
    isLoading,
    error,
    readWorkflowSnapshot: getSnapshot,
    transactWorkflow,
    canUndo,
    canRedo,
    undo,
    redo,
  }

  return <WorkflowSessionContext.Provider value={value}>{children}</WorkflowSessionContext.Provider>
}
