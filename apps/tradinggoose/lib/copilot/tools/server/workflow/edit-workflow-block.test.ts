import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolArgSchemas, ToolResultSchemas } from '@/lib/copilot/registry'
import { editWorkflowBlockServerTool } from '@/lib/copilot/tools/server/workflow/edit-workflow-block'
import { parseTgMermaidToWorkflow } from '@/lib/workflows/studio-workflow-mermaid'
import { buildInitialSubBlockStates } from '@/lib/workflows/subblock-values'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getBlock } from '@/blocks'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

const mockLoad = vi.hoisted(() => vi.fn())
const mockApply = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copilot/tools/server/entities/workflow', () => ({
  loadWorkflowSnapshotForCopilot: (...args: any[]) => mockLoad(...args),
}))
vi.mock('@/lib/copilot/tools/server/entities/shared', () => ({
  verifySavedEntityContext: vi.fn(async () => ({ userId: 'user-1', workspaceId: 'workspace-1' })),
}))
vi.mock('@/lib/yjs/server/apply-workflow-state', () => ({
  applyWorkflowState: (...args: any[]) => mockApply(...args),
}))
vi.mock('@/blocks/registry', async () => {
  const { LoopBlock } = await import('@/blocks/blocks/loop')
  const { ParallelContainerBlock } = await import('@/blocks/blocks/parallel_container')
  const { SttBlock } = await import('@/blocks/blocks/stt')
  const { AgentBlock } = await import('@/blocks/blocks/agent')
  const { MongoDBBlock } = await import('@/blocks/blocks/mongodb')
  const { PolymarketBlock } = await import('@/blocks/blocks/polymarket')
  const { WaitBlock } = await import('@/blocks/blocks/wait')
  const { SerperBlock } = await import('@/blocks/blocks/serper')
  const { VideoGeneratorBlock } = await import('@/blocks/blocks/video_generator')
  const registry = {
    loop: LoopBlock,
    parallel: ParallelContainerBlock,
    stt: SttBlock,
    agent: AgentBlock,
    mongodb: MongoDBBlock,
    polymarket: PolymarketBlock,
    wait: WaitBlock,
    serper: SerperBlock,
    video_generator: VideoGeneratorBlock,
    function: {
      type: 'function',
      name: 'Function',
      subBlocks: [{ id: 'code', type: 'code' }],
      inputs: { code: { type: 'string' } },
      outputs: {},
    },
  }
  return { getBlock: (type: string) => registry[type as keyof typeof registry] }
})
vi.mock('@/blocks', async () => ({ getBlock: (await import('@/blocks/registry')).getBlock }))

function block(id: string, type: string, values: Record<string, unknown> = {}): BlockState {
  return {
    id,
    type,
    name: id,
    position: { x: 0, y: 0 },
    enabled: true,
    outputs: {},
    subBlocks: buildInitialSubBlockStates(
      getBlock(type)!.subBlocks,
      values
    ) as BlockState['subBlocks'],
  }
}
function workflow(): WorkflowSnapshot {
  const blocks = {
    loop1: {
      ...block('loop1', 'loop', { forEachItems: ['NVDA'], whileCondition: '<variable.running>' }),
      data: { width: 800, height: 600 },
    },
    parallel1: {
      ...block('parallel1', 'parallel', { count: 3, distribution: ['AAPL'] }),
      data: { parentId: 'loop1', extent: 'parent' as const, width: 500, height: 400 },
    },
    fn1: {
      ...block('fn1', 'function', { code: 'return { ok: true }' }),
      data: { parentId: 'parallel1', extent: 'parent' as const },
    },
  }
  return {
    direction: 'TD',
    blocks,
    edges: [
      {
        id: 'loop-parallel',
        source: 'loop1',
        target: 'parallel1',
        sourceHandle: 'loop-start-source',
        targetHandle: 'target',
      },
      {
        id: 'parallel-function',
        source: 'parallel1',
        target: 'fn1',
        sourceHandle: 'parallel-start-source',
        targetHandle: 'target',
      },
    ],
    loops: generateLoopBlocks(blocks),
    parallels: generateParallelBlocks(blocks),
  }
}
let current: WorkflowSnapshot

describe('editWorkflowBlockServerTool', () => {
  beforeEach(() => {
    current = workflow()
    mockLoad.mockReset()
    mockApply.mockReset()
    mockLoad.mockImplementation(async () => ({
      entityName: 'Strategy Workflow',
      workflowState: current,
      variables: {},
    }))
  })

  it('preserves the ordinary block edit contract', async () => {
    const result = await editWorkflowBlockServerTool.execute(
      {
        entityId: 'wf-1',
        blockId: 'fn1',
        blockType: 'function',
        name: 'Compute Indicators',
        subBlocks: { code: 'return { rsi: 50 }' },
      },
      { userId: 'user-1', accessLevel: 'limited' }
    )
    expect(result.workflowState.blocks.fn1.name).toBe('Compute Indicators')
    expect(result.workflowState.blocks.fn1.subBlocks.code.value).toBe('return { rsi: 50 }')
    expect(result.workflowState.edges).toEqual(current.edges)
    expect(ToolResultSchemas.edit_workflow_block.parse(result)).toMatchObject({
      entityName: 'Strategy Workflow',
    })
    expect(mockLoad).toHaveBeenCalledWith(
      'wf-1',
      { userId: 'user-1', accessLevel: 'limited' },
      'write'
    )
  })

  it('allows unrelated edits beside valid conditional fields and runtime values', async () => {
    current.blocks.whisper = block('whisper', 'stt', { provider: 'whisper', model: 'whisper-1' })
    current.blocks.agent = block('agent', 'agent', { model: 'gpt-4.1', temperature: 1.5 })
    current.blocks.market = block('market', 'polymarket', {
      operation: 'get_price_history',
      startTs: '<variable.startTime>',
      endTs: '{{END_TIME}}',
    })
    current.blocks.wait = block('wait', 'wait', { timeUnit: '<variable.unit>' })
    current.blocks.search = block('search', 'serper', { num: 10 })
    current.blocks.video = block('video', 'video_generator', { provider: 'runway', duration: 5 })
    current.blocks.mongo = block('mongo', 'mongodb', {
      operation: 'update',
      upsert: true,
      multi: false,
    })

    const result = await editWorkflowBlockServerTool.execute(
      { entityId: 'wf-1', blockId: 'fn1', subBlocks: { code: 'return 42' } },
      { userId: 'user-1', accessLevel: 'limited' }
    )

    expect(result.workflowState.blocks.fn1.subBlocks.code.value).toBe('return 42')
    for (const id of ['whisper', 'agent', 'market', 'wait', 'search', 'video', 'mongo']) {
      expect(result.workflowState.blocks[id]).toEqual(current.blocks[id])
    }
    expect(result.preview.blockDiff).toEqual({ added: [], removed: [], updated: ['fn1'] })

    const booleanEdit = await editWorkflowBlockServerTool.execute(
      { entityId: 'wf-1', blockId: 'mongo', subBlocks: { upsert: false, multi: true } },
      { userId: 'user-1', accessLevel: 'limited' }
    )
    expect(booleanEdit.workflowState.blocks.mongo.subBlocks).toMatchObject({
      upsert: { value: false },
      multi: { value: true },
    })
  })

  it.each([
    { id: 'loop1', patch: { iterations: 100 }, runtime: { iterations: 100, loopType: 'for' } },
    {
      id: 'loop1',
      patch: { loopType: 'forEach', iterations: '', forEachItems: ['NVDA', 'AAPL'] },
      runtime: { loopType: 'forEach', iterations: 0, forEachItems: ['NVDA', 'AAPL'] },
    },
    {
      id: 'loop1',
      patch: { loopType: 'forEach', forEachItems: { symbol: 'NVDA' } },
      runtime: { loopType: 'forEach', forEachItems: { symbol: 'NVDA' } },
    },
    {
      id: 'loop1',
      patch: { loopType: 'forEach', forEachItems: '["NVDA"]' },
      runtime: { loopType: 'forEach', forEachItems: '["NVDA"]' },
    },
    {
      id: 'loop1',
      patch: { loopType: 'forEach', forEachItems: '<fn1.symbols>' },
      runtime: { loopType: 'forEach', forEachItems: '<fn1.symbols>' },
    },
    {
      id: 'loop1',
      patch: { loopType: 'while', iterations: '', whileCondition: '<variable.running> === true' },
      runtime: { loopType: 'while', iterations: 0, whileCondition: '<variable.running> === true' },
    },
    {
      id: 'loop1',
      patch: { loopType: 'doWhile', iterations: '', whileCondition: '<fn1.rsi> < 70' },
      runtime: { loopType: 'doWhile', iterations: 0, whileCondition: '<fn1.rsi> < 70' },
    },
    { id: 'parallel1', patch: { count: 20 }, runtime: { parallelType: 'count', count: 20 } },
    {
      id: 'parallel1',
      patch: { parallelType: 'collection', count: '', distribution: ['NVDA'] },
      runtime: { parallelType: 'collection', count: 0, distribution: ['NVDA'] },
    },
    {
      id: 'parallel1',
      patch: { parallelType: 'collection', distribution: { symbol: 'NVDA' } },
      runtime: { parallelType: 'collection', distribution: { symbol: 'NVDA' } },
    },
    {
      id: 'parallel1',
      patch: { parallelType: 'collection', distribution: '<fn1.symbols>' },
      runtime: { parallelType: 'collection', distribution: '<fn1.symbols>' },
    },
    {
      id: 'parallel1',
      patch: { parallelType: 'collection', distribution: '["NVDA"]' },
      runtime: { parallelType: 'collection', distribution: '["NVDA"]' },
    },
  ])('edits $id using canonical subBlocks: $patch', async ({ id, patch, runtime }) => {
    const original = structuredClone(current)
    const result = await editWorkflowBlockServerTool.execute(
      { entityId: 'wf-1', blockId: id, subBlocks: patch },
      { userId: 'user-1', accessLevel: 'limited' }
    )
    for (const [key, value] of Object.entries(patch))
      expect(result.workflowState.blocks[id].subBlocks[key].value).toEqual(value)
    for (const [key, value] of Object.entries(original.blocks[id].subBlocks)) {
      if (!(key in patch)) expect(result.workflowState.blocks[id].subBlocks[key]).toEqual(value)
    }
    expect(result.workflowState.blocks[id].data).toEqual(original.blocks[id].data)
    expect(result.workflowState.edges).toEqual(original.edges)
    for (const otherId of Object.keys(original.blocks).filter((key) => key !== id))
      expect(result.workflowState.blocks[otherId]).toEqual(original.blocks[otherId])
    const derived = id === 'loop1' ? result.workflowState.loops : result.workflowState.parallels
    expect(derived[id]).toMatchObject(runtime)
    expect(derived[id].nodes).toEqual(id === 'loop1' ? ['parallel1'] : ['fn1'])
    expect(result.preview.blockDiff).toEqual({ added: [], removed: [], updated: [id] })
    expect(result.requiresReview).toBe(true)
    expect(mockApply).not.toHaveBeenCalled()
    const roundTrip = parseTgMermaidToWorkflow(result.entityDocument)
    expect(roundTrip.blocks[id].subBlocks).toEqual(result.workflowState.blocks[id].subBlocks)
    expect(id === 'loop1' ? roundTrip.loops[id] : roundTrip.parallels[id]).toMatchObject(runtime)
    expect(current).toEqual(original)
  })

  it.each([
    ['loop1', { loopType: 'forEach' }, { loopType: 'forEach', forEachItems: ['NVDA'] }],
    ['loop1', { loopType: 'while' }, { loopType: 'while', whileCondition: '<variable.running>' }],
    [
      'parallel1',
      { parallelType: 'collection' },
      { parallelType: 'collection', distribution: ['AAPL'] },
    ],
  ])('switches %s modes without resetting unpatched settings', async (id, patch, expected) => {
    const result = await editWorkflowBlockServerTool.execute(
      { entityId: 'wf-1', blockId: id as string, subBlocks: patch as Record<string, unknown> },
      { userId: 'user-1', accessLevel: 'limited' }
    )
    expect(
      id === 'loop1' ? result.workflowState.loops.loop1 : result.workflowState.parallels.parallel1
    ).toMatchObject(expected)
  })

  it.each(['loop1', 'parallel1'])('applies %s edits with full access', async (id) => {
    const subBlocks =
      id === 'loop1'
        ? { loopType: 'doWhile', whileCondition: 'false' }
        : { parallelType: 'collection', distribution: ['NVDA'] }
    const result = await editWorkflowBlockServerTool.execute(
      { entityId: 'wf-1', blockId: id, name: 'Updated Research', enabled: false, subBlocks },
      { userId: 'user-1', accessLevel: 'full' }
    )
    expect(result.requiresReview).toBeUndefined()
    expect(result.workflowState.blocks[id]).toMatchObject({
      name: 'Updated Research',
      enabled: false,
    })
    expect(mockApply).toHaveBeenCalledExactlyOnceWith('wf-1', 'user-1', result.workflowState, {})
  })

  it.each([
    ['loop1', { loopType: 'while', whileCondition: '' }],
    ['loop1', { loopType: 'forEach', forEachItems: '' }],
    ['parallel1', { parallelType: 'collection', distribution: '' }],
  ])('permits blank draft values for %s', async (id, patch) => {
    await expect(
      editWorkflowBlockServerTool.execute(
        { entityId: 'wf-1', blockId: id as string, subBlocks: patch as Record<string, unknown> },
        { userId: 'user-1', accessLevel: 'limited' }
      )
    ).resolves.toMatchObject({ success: true })
  })

  it.each([
    ['loop1', 'loopType', 'invalid'],
    ['parallel1', 'parallelType', 'invalid'],
    ['loop1', 'count', 3],
    ['parallel1', 'forEachItems', []],
    ['fn1', 'iterations', 5],
  ])('rejects invalid %s subBlocks.%s values', async (id, key, value) => {
    await expect(
      editWorkflowBlockServerTool.execute(
        { entityId: 'wf-1', blockId: id as string, subBlocks: { [key as string]: value } },
        { userId: 'user-1', accessLevel: 'limited' }
      )
    ).rejects.toMatchObject({
      code: 'invalid_workflow_block_edit',
      issues: expect.arrayContaining([expect.objectContaining({ path: `subBlocks.${key}` })]),
    })
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('rejects an invalid active condition through shared block validation', async () => {
    await expect(
      editWorkflowBlockServerTool.execute(
        {
          entityId: 'wf-1',
          blockId: 'loop1',
          subBlocks: { loopType: 'while', whileCondition: false },
        },
        { userId: 'user-1', accessLevel: 'limited' }
      )
    ).rejects.toMatchObject({
      code: 'invalid_workflow_block_edit',
      issues: expect.arrayContaining([
        expect.objectContaining({ path: 'subBlocks.whileCondition' }),
      ]),
    })
  })
})

describe('edit_workflow_block argument schema', () => {
  it('uses the standard subBlocks patch for container configurations', () => {
    const args = {
      entityId: 'wf-1',
      blockId: 'loop1',
      subBlocks: { loopType: 'forEach', forEachItems: ['NVDA'] },
    }
    expect(ToolArgSchemas.edit_workflow_block.parse(args)).toEqual(args)
  })
  it.each(['count', 'loopType', 'parallelType', 'collection', 'whileCondition'])(
    'rejects block-specific top-level %s',
    (key) => {
      expect(
        ToolArgSchemas.edit_workflow_block.safeParse({
          entityId: 'wf-1',
          blockId: 'loop1',
          [key]: 3,
        }).success
      ).toBe(false)
    }
  )
})
