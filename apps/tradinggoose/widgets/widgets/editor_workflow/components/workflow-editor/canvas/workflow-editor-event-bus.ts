type Listener<T> = (payload: T) => void

export type WorkflowEventScope = {
  channelId: string
  workflowId: string
}

export type WorkflowRecordMovePayload = WorkflowEventScope & {
  blockId: string
  before: { x: number; y: number; parentId?: string | null }
  after: { x: number; y: number; parentId?: string | null }
}

export type WorkflowRecordParentUpdatePayload = WorkflowEventScope & {
  blockId: string
  oldParentId?: string
  newParentId?: string
  oldPosition: { x: number; y: number }
  newPosition: { x: number; y: number }
  affectedEdges: Array<Record<string, unknown>>
}

export type SkipEdgeRecordingPayload = WorkflowEventScope & {
  skip: boolean
}

export type RemoveFromSubflowPayload = WorkflowEventScope & {
  blockId: string
}

export type UpdateSubBlockValuePayload = WorkflowEventScope & {
  blockId: string
  subBlockId: string
  value: unknown
}

export type ScheduleUpdatedPayload = WorkflowEventScope & {
  blockId: string
}

const recordMoveListeners = new Set<Listener<WorkflowRecordMovePayload>>()
const recordParentUpdateListeners = new Set<Listener<WorkflowRecordParentUpdatePayload>>()
const skipEdgeRecordingListeners = new Set<Listener<SkipEdgeRecordingPayload>>()
const removeFromSubflowListeners = new Set<Listener<RemoveFromSubflowPayload>>()
const updateSubBlockValueListeners = new Set<Listener<UpdateSubBlockValuePayload>>()
const scheduleUpdatedListeners = new Set<Listener<ScheduleUpdatedPayload>>()

const subscribe = <T>(listeners: Set<Listener<T>>, listener: Listener<T>) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const emit = <T>(listeners: Set<Listener<T>>, payload: T) => {
  for (const listener of listeners) {
    listener(payload)
  }
}

const isMatchingScope = (scope: WorkflowEventScope, payload: WorkflowEventScope) => {
  return scope.channelId === payload.channelId && scope.workflowId === payload.workflowId
}

export const subscribeWorkflowRecordMove = (
  scope: WorkflowEventScope,
  listener: Listener<WorkflowRecordMovePayload>
) =>
  subscribe(recordMoveListeners, (payload) => {
    if (!isMatchingScope(scope, payload)) return
    listener(payload)
  })

export const emitWorkflowRecordMove = (payload: WorkflowRecordMovePayload) =>
  emit(recordMoveListeners, payload)

export const subscribeWorkflowRecordParentUpdate = (
  scope: WorkflowEventScope,
  listener: Listener<WorkflowRecordParentUpdatePayload>
) =>
  subscribe(recordParentUpdateListeners, (payload) => {
    if (!isMatchingScope(scope, payload)) return
    listener(payload)
  })

export const emitWorkflowRecordParentUpdate = (payload: WorkflowRecordParentUpdatePayload) =>
  emit(recordParentUpdateListeners, payload)

export const subscribeSkipEdgeRecording = (
  scope: WorkflowEventScope,
  listener: Listener<SkipEdgeRecordingPayload>
) =>
  subscribe(skipEdgeRecordingListeners, (payload) => {
    if (!isMatchingScope(scope, payload)) return
    listener(payload)
  })

export const emitSkipEdgeRecording = (payload: SkipEdgeRecordingPayload) =>
  emit(skipEdgeRecordingListeners, payload)

export const subscribeRemoveFromSubflow = (
  scope: WorkflowEventScope,
  listener: Listener<RemoveFromSubflowPayload>
) =>
  subscribe(removeFromSubflowListeners, (payload) => {
    if (!isMatchingScope(scope, payload)) return
    listener(payload)
  })

export const emitRemoveFromSubflow = (payload: RemoveFromSubflowPayload) =>
  emit(removeFromSubflowListeners, payload)

export const subscribeUpdateSubBlockValue = (
  scope: WorkflowEventScope,
  listener: Listener<UpdateSubBlockValuePayload>
) =>
  subscribe(updateSubBlockValueListeners, (payload) => {
    if (!isMatchingScope(scope, payload)) return
    listener(payload)
  })

export const emitUpdateSubBlockValue = (payload: UpdateSubBlockValuePayload) =>
  emit(updateSubBlockValueListeners, payload)

export const subscribeScheduleUpdated = (
  scope: WorkflowEventScope,
  listener: Listener<ScheduleUpdatedPayload>
) =>
  subscribe(scheduleUpdatedListeners, (payload) => {
    if (!isMatchingScope(scope, payload)) return
    listener(payload)
  })

export const emitScheduleUpdated = (payload: ScheduleUpdatedPayload) =>
  emit(scheduleUpdatedListeners, payload)
