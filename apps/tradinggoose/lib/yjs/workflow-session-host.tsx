'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import * as Y from 'yjs'
import {
  EMPTY_SHARED_WORKFLOW_SESSION_STATE,
  acquireSharedWorkflowSession,
  getSharedWorkflowSessionState,
  redoSharedWorkflowSession,
  setSharedWorkflowSessionUser,
  subscribeToSharedWorkflowSession,
  undoSharedWorkflowSession,
  type SharedWorkflowSessionState,
} from '@/lib/yjs/workflow-shared-session'
import {
  getWorkflowSnapshotCloned,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

export interface WorkflowSessionContextValue {
  workflowId: string
  doc: Y.Doc | null
  awareness: any | null
  isSynced: boolean
  isLoading: boolean
  error: string | null
  getWorkflowSnapshot: () => WorkflowSnapshot | null
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
  user?: WorkflowSessionUser
  children: ReactNode
}

export function WorkflowSessionProvider({
  workspaceId,
  workflowId,
  user,
  children,
}: WorkflowSessionProviderProps) {
  const [state, setState] = useState<SharedWorkflowSessionState>(() =>
    workflowId ? getSharedWorkflowSessionState(workflowId) : { ...EMPTY_SHARED_WORKFLOW_SESSION_STATE }
  )
  const { doc, awareness, isSynced, isLoading, error, canUndo, canRedo } = state

  useEffect(() => {
    if (!workflowId) {
      setState({ ...EMPTY_SHARED_WORKFLOW_SESSION_STATE })
      return
    }

    const syncState = () => {
      setState(getSharedWorkflowSessionState(workflowId))
    }

    syncState()
    const release = acquireSharedWorkflowSession({
      workflowId,
      workspaceId,
    })
    const unsubscribe = subscribeToSharedWorkflowSession(workflowId, syncState)
    syncState()

    return () => {
      unsubscribe()
      release()
      setState({ ...EMPTY_SHARED_WORKFLOW_SESSION_STATE })
    }
  }, [workflowId, workspaceId])

  useEffect(() => {
    setSharedWorkflowSessionUser(workflowId, user)
  }, [awareness, workflowId, user])

  const getSnapshot = useCallback((): WorkflowSnapshot | null => {
    if (!doc) return null
    return getWorkflowSnapshotCloned(doc)
  }, [doc])

  const transactWorkflow = useCallback(
    (fn: (d: Y.Doc) => void, origin?: string) => {
      if (!doc) return
      doc.transact(() => fn(doc), origin ?? YJS_ORIGINS.USER)
    },
    [doc]
  )

  const undo = useCallback(() => {
    undoSharedWorkflowSession(workflowId)
  }, [workflowId])

  const redo = useCallback(() => {
    redoSharedWorkflowSession(workflowId)
  }, [workflowId])

  const value: WorkflowSessionContextValue = {
    workflowId,
    doc,
    awareness,
    isSynced,
    isLoading,
    error,
    getWorkflowSnapshot: getSnapshot,
    transactWorkflow,
    canUndo,
    canRedo,
    undo,
    redo,
  }

  return (
    <WorkflowSessionContext.Provider value={value}>
      {children}
    </WorkflowSessionContext.Provider>
  )
}
