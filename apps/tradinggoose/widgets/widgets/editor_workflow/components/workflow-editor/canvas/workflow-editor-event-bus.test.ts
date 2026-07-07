import { beforeEach, describe, expect, it, vi } from 'vitest'

const MODULE_PATH =
  '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'

describe('workflow editor event bus scoping', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('routes remove-from-subflow only to matching workflow scope', async () => {
    const { subscribeRemoveFromSubflow, emitRemoveFromSubflow } = await import(MODULE_PATH)

    const scopedListener = vi.fn()
    const otherScopeListener = vi.fn()

    subscribeRemoveFromSubflow({ workflowId: 'wf-1' }, scopedListener)
    subscribeRemoveFromSubflow({ workflowId: 'wf-2' }, otherScopeListener)

    emitRemoveFromSubflow({
      blockId: 'block-1',
      workflowId: 'wf-1',
    })

    expect(scopedListener).toHaveBeenCalledTimes(1)
    expect(otherScopeListener).not.toHaveBeenCalled()
  })

  it('routes update-subblock-value only to matching workflow', async () => {
    const { subscribeUpdateSubBlockValue, emitUpdateSubBlockValue } = await import(MODULE_PATH)

    const wf1Listener = vi.fn()
    const wf2Listener = vi.fn()

    subscribeUpdateSubBlockValue({ workflowId: 'wf-1' }, wf1Listener)
    subscribeUpdateSubBlockValue({ workflowId: 'wf-2' }, wf2Listener)

    emitUpdateSubBlockValue({
      blockId: 'block-7',
      subBlockId: 'prompt',
      value: 'updated',
      workflowId: 'wf-2',
    })

    expect(wf1Listener).not.toHaveBeenCalled()
    expect(wf2Listener).toHaveBeenCalledTimes(1)
  })

  it('routes workflow-record-move and parent-update only to matching scope', async () => {
    const {
      subscribeWorkflowRecordMove,
      emitWorkflowRecordMove,
      subscribeWorkflowRecordParentUpdate,
      emitWorkflowRecordParentUpdate,
    } = await import(MODULE_PATH)

    const moveScoped = vi.fn()
    const moveOther = vi.fn()
    const parentScoped = vi.fn()
    const parentOther = vi.fn()

    const scopeA = { workflowId: 'wf-1' }
    const scopeB = { workflowId: 'wf-2' }

    subscribeWorkflowRecordMove(scopeA, moveScoped)
    subscribeWorkflowRecordMove(scopeB, moveOther)
    subscribeWorkflowRecordParentUpdate(scopeA, parentScoped)
    subscribeWorkflowRecordParentUpdate(scopeB, parentOther)

    emitWorkflowRecordMove({
      ...scopeA,
      blockId: 'block-1',
      before: { x: 10, y: 20, parentId: null },
      after: { x: 30, y: 40, parentId: 'loop-1' },
    })

    emitWorkflowRecordParentUpdate({
      ...scopeA,
      blockId: 'block-2',
      oldParentId: undefined,
      newParentId: 'loop-1',
      oldPosition: { x: 1, y: 2 },
      newPosition: { x: 3, y: 4 },
      affectedEdges: [],
    })

    expect(moveScoped).toHaveBeenCalledTimes(1)
    expect(moveOther).not.toHaveBeenCalled()
    expect(parentScoped).toHaveBeenCalledTimes(1)
    expect(parentOther).not.toHaveBeenCalled()
  })

  it('routes skip-edge-recording only to matching scope', async () => {
    const { subscribeSkipEdgeRecording, emitSkipEdgeRecording } = await import(MODULE_PATH)

    const scopeAListener = vi.fn()
    const scopeBListener = vi.fn()
    const scopeA = { workflowId: 'wf-1' }
    const scopeB = { workflowId: 'wf-2' }

    subscribeSkipEdgeRecording(scopeA, scopeAListener)
    subscribeSkipEdgeRecording(scopeB, scopeBListener)

    emitSkipEdgeRecording({ ...scopeB, skip: true })

    expect(scopeAListener).not.toHaveBeenCalled()
    expect(scopeBListener).toHaveBeenCalledTimes(1)
    expect(scopeBListener).toHaveBeenCalledWith({ ...scopeB, skip: true })
  })

  it('stops receiving scoped events after unsubscribe', async () => {
    const { subscribeRemoveFromSubflow, emitRemoveFromSubflow } = await import(MODULE_PATH)

    const listener = vi.fn()

    const unsubscribe = subscribeRemoveFromSubflow({ workflowId: 'wf-1' }, listener)

    unsubscribe()

    emitRemoveFromSubflow({
      blockId: 'block-1',
      workflowId: 'wf-1',
    })

    expect(listener).not.toHaveBeenCalled()
  })
})
