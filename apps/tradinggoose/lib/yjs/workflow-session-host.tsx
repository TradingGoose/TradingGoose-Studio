'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type * as Y from 'yjs'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { useYjsTargetSession } from '@/lib/yjs/use-entity-fields'
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
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

export interface WorkflowSessionContextValue {
  workflowId: string
  canEdit: boolean
  doc: Y.Doc | null
  awareness: SharedWorkflowSessionState['awareness']
  isSynced: boolean
  isLoading: boolean
  error: string | null
  readWorkflowSnapshot: () => WorkflowSnapshot | null
  transactWorkflow: <T>(fn: (doc: Y.Doc) => T, origin?: string) => T | undefined
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
  canWrite?: boolean
  children: ReactNode
}

export function WorkflowSessionProvider({
  workspaceId,
  workflowId,
  user,
  canWrite = true,
  children,
}: WorkflowSessionProviderProps) {
  const { canEdit: canEditWorkspace, isLoading: isPermissionsLoading } = useUserPermissionsContext()
  const canEdit = canEditWorkspace && canWrite
  const [writeState, setWriteState] = useState<SharedWorkflowSessionState>(() =>
    getSharedWorkflowSessionState(workflowId)
  )
  const readDescriptor = useMemo(
    () =>
      !isPermissionsLoading && !canEdit && workspaceId
        ? buildSavedEntityDescriptor('workflow', workflowId, workspaceId)
        : null,
    [canEdit, isPermissionsLoading, workflowId, workspaceId]
  )
  const readSession = useYjsTargetSession(
    readDescriptor,
    'read',
    'Failed to open read-only workflow session'
  )
  const readOnly = !isPermissionsLoading && !canEdit
  const doc = isPermissionsLoading ? null : readOnly ? readSession.doc : writeState.doc
  const writableDocRef = useRef<Y.Doc | null>(null)
  writableDocRef.current = !isPermissionsLoading && canEdit ? writeState.doc : null
  const awareness = isPermissionsLoading
    ? null
    : readOnly
      ? (readSession.result?.provider.awareness ?? null)
      : writeState.awareness
  const isSynced = isPermissionsLoading
    ? false
    : readOnly
      ? readSession.result?.provider.synced === true
      : writeState.isSynced
  const isLoading =
    isPermissionsLoading || (readOnly ? readSession.isLoading : writeState.isLoading)
  const error = isPermissionsLoading ? null : readOnly ? readSession.error : writeState.error
  const canUndo = !isPermissionsLoading && canEdit && writeState.canUndo
  const canRedo = !isPermissionsLoading && canEdit && writeState.canRedo

  useEffect(() => {
    if (!canEdit) return

    const syncState = () => {
      setWriteState(getSharedWorkflowSessionState(workflowId))
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
      setWriteState({ ...EMPTY_SHARED_WORKFLOW_SESSION_STATE })
    }
  }, [canEdit, workflowId, workspaceId])

  useEffect(() => {
    if (canEdit) setSharedWorkflowSessionUser(workflowId, user)
  }, [canEdit, awareness, workflowId, user])

  const getSnapshot = useCallback((): WorkflowSnapshot | null => {
    if (!doc) return null
    return readWorkflowSnapshotCloned(doc)
  }, [doc])

  const transactWorkflow = useCallback(
    <T,>(fn: (d: Y.Doc) => T, origin?: string): T | undefined => {
      const writableDoc = writableDocRef.current
      if (!writableDoc) return undefined
      let result: T | undefined
      writableDoc.transact(() => {
        result = fn(writableDoc)
      }, origin ?? YJS_ORIGINS.USER)
      return result
    },
    []
  )

  const undo = useCallback(() => {
    if (canEdit) undoSharedWorkflowSession(workflowId)
  }, [canEdit, workflowId])

  const redo = useCallback(() => {
    if (canEdit) redoSharedWorkflowSession(workflowId)
  }, [canEdit, workflowId])

  const value: WorkflowSessionContextValue = {
    workflowId,
    canEdit,
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
