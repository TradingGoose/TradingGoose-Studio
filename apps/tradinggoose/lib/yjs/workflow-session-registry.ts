'use client'

import * as Y from 'yjs'
import {
  YJS_KEYS,
  getWorkflowMap,
  getVariablesSnapshot,
  getWorkflowSnapshot,
  readWorkflowTextFieldValue,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export interface RegisteredWorkflowSession {
  workflowId: string
  doc: Y.Doc
}

const sessions = new Map<string, RegisteredWorkflowSession>()

export function registerWorkflowSession(session: RegisteredWorkflowSession): void {
  sessions.set(session.workflowId, session)
}

export function unregisterWorkflowSession(
  workflowId: string | null | undefined,
  doc?: Y.Doc | null
): void {
  if (!workflowId) {
    return
  }

  const existingSession = sessions.get(workflowId)
  if (!existingSession) {
    return
  }

  if (!doc) {
    sessions.delete(workflowId)
    return
  }

  if (existingSession.doc === doc) {
    sessions.delete(workflowId)
  }
}

export function getRegisteredWorkflowSession(
  workflowId: string | null | undefined
): RegisteredWorkflowSession | null {
  if (!workflowId) {
    return null
  }

  return sessions.get(workflowId) ?? null
}

// ---------------------------------------------------------------------------
// Convenience accessors that combine registry lookup + snapshot read
// ---------------------------------------------------------------------------

/**
 * Returns the workflow snapshot for a registered session, or null if no
 * active session exists for the given workflow.
 */
export function getSnapshotForWorkflow(
  workflowId: string | null | undefined
): WorkflowSnapshot | null {
  const session = getRegisteredWorkflowSession(workflowId)
  if (!session?.doc) return null
  return getWorkflowSnapshot(session.doc)
}

/**
 * Reads a single subblock value from the live Yjs session.
 * Returns null when the session, block, or subblock doesn't exist.
 *
 * Reads directly from the Y.Map instead of building a full snapshot,
 * avoiding O(N) deep-clone overhead when only one value is needed.
 */
export function readSubBlockValue(
  workflowId: string | null | undefined,
  blockId: string,
  subBlockId: string
): any {
  const session = getRegisteredWorkflowSession(workflowId)
  if (!session?.doc) return null
  const liveTextValue = readWorkflowTextFieldValue(session.doc, blockId, subBlockId)
  if (liveTextValue !== null) {
    return liveTextValue
  }
  const wMap = getWorkflowMap(session.doc)
  const blocks = wMap.get(YJS_KEYS.BLOCKS) as Record<string, any> | undefined
  return blocks?.[blockId]?.subBlocks?.[subBlockId]?.value ?? null
}

/**
 * Reads a subblock value using the currently active workflow from the registry.
 * Convenience wrapper used by trigger pollers and other consumers that operate
 * in an "active workflow" context.
 */
export function readActiveSubBlockValue(blockId: string, subBlockId: string): any {
  const activeWorkflowId = useWorkflowRegistry.getState().getActiveWorkflowId()
  return readSubBlockValue(activeWorkflowId, blockId, subBlockId)
}

/**
 * Returns the variables snapshot for a registered session, or null if no
 * active session exists for the given workflow.
 */
export function getVariablesForWorkflow(
  workflowId: string | null | undefined
): Record<string, any> | null {
  const session = getRegisteredWorkflowSession(workflowId)
  if (!session?.doc) return null
  return getVariablesSnapshot(session.doc)
}
