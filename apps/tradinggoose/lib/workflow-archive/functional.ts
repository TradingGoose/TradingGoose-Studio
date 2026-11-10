import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import type { ToolCall, TraceSpan } from '@/lib/logs/types'
import type { InferenceFacts } from '@/lib/mastra/result'
import { type NativePayloadRef, readFunctionalPayload } from '@/lib/mastra/workflow-history'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { WorkflowCheckpointSnapshot } from '@/lib/workflows/human-in-the-loop/types'
import { checkpointFunctionalOutput } from '@/executor/checkpoint'
import { assertOccurrenceIds, type NormalizedBlockOutput } from '@/executor/types'
import type { ArchiveReference, ArchiveScope } from './format'
import { readPrivateArchive } from './io'

export type FunctionalBlock = {
  id: string
  parentId?: string
  name: string
  type: string
  blockId?: string
  duration: number
  startTime: string
  endTime: string
  status?: 'success' | 'error'
  input?: unknown
  output?: unknown
  toolCalls?: unknown
  nativePayload?: NativePayloadRef
}

export function functionalOutput(
  output: unknown,
  facts?: Pick<InferenceFacts, 'generatedFields'>
): unknown {
  if (!output || typeof output !== 'object' || Array.isArray(output) || !facts) return output
  return Object.fromEntries(
    Object.entries(output).filter(([key]) => !facts.generatedFields.includes(key))
  )
}

/** Flatten actual block occurrences; diagnostic-only provider spans never become payload history. */
export function projectFunctionalBlocks(spans: TraceSpan[]): FunctionalBlock[] {
  const result: FunctionalBlock[] = []
  const visit = (entries: TraceSpan[], parentId?: string) => {
    for (const span of entries) {
      const inference = (span as TraceSpan & { inference?: InferenceFacts }).inference
      const functional = Boolean(span.blockId || span.type === 'tool' || span.toolCalls?.length)
      let nextParent = parentId
      if (functional) {
        const id = span.id
        const nativePayload = inference?.nativePayload
        result.push({
          id,
          ...(parentId ? { parentId } : {}),
          name: span.name,
          type: span.type,
          ...(span.blockId ? { blockId: span.blockId } : {}),
          duration: span.duration,
          startTime: span.startTime,
          endTime: span.endTime,
          ...(span.status ? { status: span.status } : {}),
          ...(nativePayload
            ? { nativePayload }
            : {
                input: span.input,
                output: functionalOutput(span.output, inference),
                toolCalls: span.toolCalls,
              }),
        })
        nextParent = id
      }
      if (span.children) visit(span.children, nextParent)
    }
  }
  visit(spans)
  assertOccurrenceIds(result, 'Malformed functional block occurrence')
  return checkpointFunctionalOutput(result)
}

export async function hydrateFunctionalBlocks(blocks: unknown): Promise<TraceSpan[]> {
  if (!Array.isArray(blocks)) throw new Error('Canonical functional block list is missing')
  assertOccurrenceIds(blocks, 'Malformed functional block occurrence')
  const spans = new Map<string, TraceSpan>()
  const parentIds = new Map<string, string | undefined>()
  for (const value of blocks as FunctionalBlock[]) {
    const payload = value.nativePayload
      ? await readFunctionalPayload(value.nativePayload)
      : undefined
    const input = payload
      ? { messages: payload.selectedMessages, tools: payload.tools }
      : value.input
    const output = payload ? payload.output : value.output
    const { nativePayload: _native, parentId, ...business } = value
    const toolCalls =
      payload && Array.isArray(payload.tools)
        ? payload.tools.map((run): ToolCall => {
            if (
              !run ||
              typeof run.name !== 'string' ||
              typeof run.startTime !== 'string' ||
              typeof run.endTime !== 'string' ||
              typeof run.duration !== 'number' ||
              typeof run.success !== 'boolean'
            )
              throw new Error('Canonical functional tool occurrence is malformed')
            return {
              id: run.toolCallId ?? run.id,
              name: run.name,
              duration: run.duration,
              startTime: run.startTime,
              endTime: run.endTime,
              status: run.success ? 'success' : 'error',
              input: run.arguments,
              output: run.result,
              ...(typeof run.error === 'string' ? { error: run.error } : {}),
            }
          })
        : value.toolCalls
    spans.set(value.id, {
      ...business,
      input: input as any,
      output: output as any,
      toolCalls: toolCalls as ToolCall[] | undefined,
      children: [],
    })
    parentIds.set(value.id, parentId)
  }
  const roots: TraceSpan[] = []
  for (const [id, span] of spans) {
    const parentId = parentIds.get(id)
    if (!parentId) roots.push(span)
    else {
      const parent = spans.get(parentId)
      if (!parent || parent === span) throw new Error('Invalid functional block parent')
      parent.children!.push(span)
    }
  }
  return roots
}

export const FUNCTIONAL_OUTPUT_REFERENCE = {
  version: 1,
  purpose: 'workflow-functional-output',
} as const
type ExecutionPayloadRow = ArchiveScope & { executionData: any }

/** Restore functional generated fields from their actual canonical tool payload, never report totals. */
export async function hydrateCheckpointFunctionalPayloads(
  snapshot: WorkflowCheckpointSnapshot,
  scope: ArchiveScope
): Promise<WorkflowCheckpointSnapshot> {
  const outputs = new Map<string, (saved: unknown) => NormalizedBlockOutput>()
  for (const log of snapshot.executor.context.blockLogs) {
    const facts = log.inference
    const ref = facts?.nativePayload
    if (!ref) continue // Protected original checkpoints remain self-contained and pinned.
    if (
      ref.workspaceId !== scope.workspaceId ||
      ref.executionId !== scope.executionId ||
      ref.logId !== scope.logId
    )
      throw new Error('Checkpoint native payload scope mismatch')
    const payload = await readFunctionalPayload(ref)
    if (!payload.output || typeof payload.output !== 'object' || Array.isArray(payload.output))
      throw new Error('Checkpoint canonical block output is missing')
    const fallback: Record<string, unknown> = { ...payload.output }
    const generated: Record<string, unknown> = {}
    const tools = payload.tools
    if (facts.generatedFields.includes('model')) generated.model = facts.model
    if (
      facts.generatedFields.includes('toolCalls') ||
      facts.generatedFields.includes('toolResults')
    ) {
      if (!Array.isArray(tools)) throw new Error('Checkpoint canonical tool payload is missing')
      if (facts.generatedFields.includes('toolCalls'))
        generated.toolCalls = { list: tools, count: tools.length }
      if (facts.generatedFields.includes('toolResults')) {
        const indexes = payload.toolResultIndexes
        if (
          !Array.isArray(indexes) ||
          indexes.some(
            (index, position) =>
              !Number.isSafeInteger(index) ||
              index < 0 ||
              index >= tools.length ||
              (position > 0 && index <= indexes[position - 1]) ||
              !tools[index]
          )
        )
          throw new Error('Checkpoint canonical tool result membership is missing or malformed')
        generated.toolResults = indexes
          .map((index) => tools[index])
          .map((run) =>
            run.result && typeof run.result === 'object'
              ? { ...run.result, toolCallId: run.toolCallId }
              : run.result
          )
      }
    }
    const restore = (saved: unknown): NormalizedBlockOutput => {
      const functional = checkpointFunctionalOutput(functionalOutput(saved, facts))
      return {
        ...fallback,
        ...(functional && typeof functional === 'object' && !Array.isArray(functional)
          ? functional
          : {}),
        ...generated,
      }
    }
    log.output = restore(log.output)
    outputs.set(log.blockId, restore)
  }
  snapshot.executor.context.blockStates = snapshot.executor.context.blockStates.map(
    ([id, state]) => {
      const restore = outputs.get(id)
      return [id, restore ? { ...state, output: restore(state.output) } : state]
    }
  )
  for (const [id, restore] of outputs)
    if (Object.hasOwn(snapshot.executor.currentBlockStates, id))
      snapshot.executor.currentBlockStates[id] = restore(snapshot.executor.currentBlockStates[id])
  return snapshot
}

export async function assertRetainedLogAccess(scope: ArchiveScope, userId?: string): Promise<void> {
  const [current] = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.id, scope.logId),
        eq(workflowExecutionLogs.workspaceId, scope.workspaceId),
        eq(workflowExecutionLogs.executionId, scope.executionId)
      )
    )
    .limit(1)
  if (!current) throw new Error('Retained workflow record no longer exists')
  if (userId && !(await checkWorkspaceAccess(scope.workspaceId, userId)).hasAccess)
    throw new Error('Workflow record access was revoked')
}

export async function hydrateAuthorizedLog<
  T extends { id: string; workspaceId: string; executionId: string | null; executionData?: any },
>(row: T, userId: string): Promise<T> {
  if (
    !row.executionData?.workflowArchive &&
    !row.executionData?.preservedFunctionalArchive &&
    !row.executionData?.functionalPayload
  ) {
    if (row.executionData?.traceSpans || row.executionData?.finalOutput)
      throw new Error('Workflow payload requires verified current-format preservation')
    return row
  }
  if (!row.executionId) throw new Error('Workflow payload execution identity is missing')
  const scope = { workspaceId: row.workspaceId, executionId: row.executionId, logId: row.id }
  const hydrated = await hydrateExecutionPayload(
    { ...row, ...scope, executionData: row.executionData },
    () => assertRetainedLogAccess(scope, userId)
  )
  return { ...row, executionData: hydrated.executionData }
}

/** Caller supplies a fresh uncached log/workspace authorization callback; it runs on both sides of IO. */
export async function hydrateExecutionPayload<T extends ExecutionPayloadRow>(
  row: T,
  authorize: () => Promise<void>
): Promise<T> {
  await authorize()
  const data = row.executionData && typeof row.executionData === 'object' ? row.executionData : {}
  let sections: { blocks?: unknown[]; output?: unknown } | undefined
  const archiveRef = (data.workflowArchive ??
    (!data.functionalPayload ? data.preservedFunctionalArchive : undefined)) as
    | ArchiveReference
    | undefined
  if (archiveRef) {
    if (
      archiveRef.workspaceId !== row.workspaceId ||
      archiveRef.executionId !== row.executionId ||
      archiveRef.logId !== row.logId
    )
      throw new Error('Archive reference is outside the authorized record')
    const artifact = await readPrivateArchive(archiveRef)
    sections = artifact.functional
  } else if (data.functionalPayload) {
    const ref = data.functionalPayload as NativePayloadRef
    if (
      ref.workspaceId !== row.workspaceId ||
      ref.executionId !== row.executionId ||
      ref.logId !== row.logId
    )
      throw new Error('Native payload reference is outside the authorized record')
    sections = await readFunctionalPayload(ref)
  }
  const executionData = { ...data }
  if (sections) {
    executionData.traceSpans = await hydrateFunctionalBlocks(sections.blocks ?? [])
    if (data.finalOutput?.purpose === FUNCTIONAL_OUTPUT_REFERENCE.purpose)
      executionData.finalOutput = sections.output
  } else if (data.finalOutput !== undefined || data.traceSpans !== undefined)
    throw new Error('Workflow payload requires verified current-format preservation')
  await authorize()
  return { ...row, executionData }
}
