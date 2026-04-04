import { describe, expect, it, vi } from 'vitest'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  type ResolveCanvasNodeDescriptorParams,
  resolveCanvasNodeDescriptor,
} from './block-registry'

function createBlock(
  overrides: Partial<BlockState> & Pick<BlockState, 'id' | 'type' | 'name'>
): BlockState {
  return {
    id: overrides.id,
    type: overrides.type,
    name: overrides.name,
    position: overrides.position ?? { x: 0, y: 0 },
    subBlocks: overrides.subBlocks ?? {},
    outputs: overrides.outputs ?? ({} as any),
    enabled: overrides.enabled ?? true,
    horizontalHandles: overrides.horizontalHandles,
    isWide: overrides.isWide,
    height: overrides.height,
    advancedMode: overrides.advancedMode,
    triggerMode: overrides.triggerMode,
    data: overrides.data,
    layout: overrides.layout,
  }
}

const createParams = (
  block: BlockState,
  overrides?: Partial<Omit<ResolveCanvasNodeDescriptorParams, 'block'>>
): ResolveCanvasNodeDescriptorParams => ({
  block,
  isActive: false,
  isPending: false,
  hasNestedError: false,
  resolveBlockConfig: () => ({ category: 'blocks' }) as any,
  ...overrides,
})

describe('block-registry node descriptor resolver', () => {
  it('resolves container descriptor for loop blocks', () => {
    const loopBlock = createBlock({
      id: 'loop-1',
      type: 'loop',
      name: 'Loop',
      data: {
        width: 640,
        height: 320,
      },
    })

    const descriptor = resolveCanvasNodeDescriptor(
      createParams(loopBlock, { hasNestedError: true })
    )

    expect(descriptor).toMatchObject({
      nodeType: 'subflowNode',
      width: 640,
      height: 320,
      data: {
        kind: 'loop',
        width: 640,
        height: 320,
        hasNestedError: true,
      },
    })
  })

  it('resolves workflow descriptor with config-driven data for regular blocks', () => {
    const agentBlock = createBlock({
      id: 'agent-1',
      type: 'agent',
      name: 'Agent',
      isWide: true,
      height: 180,
    })

    const descriptor = resolveCanvasNodeDescriptor(
      createParams(agentBlock, { isActive: true, isPending: true })
    )

    expect(descriptor).toMatchObject({
      nodeType: 'workflowBlock',
      width: 350,
      height: 180,
      data: {
        type: 'agent',
        name: 'Agent',
        isActive: true,
        isPending: true,
      },
    })
  })

  it('returns null and reports missing config for unsupported regular block', () => {
    const missingConfig = vi.fn()
    const unknownBlock = createBlock({
      id: 'unknown-1',
      type: 'unknown',
      name: 'Unknown',
    })

    const descriptor = resolveCanvasNodeDescriptor(
      createParams(unknownBlock, {
        resolveBlockConfig: () => undefined,
        onMissingBlockConfig: missingConfig,
      })
    )

    expect(descriptor).toBeNull()
    expect(missingConfig).toHaveBeenCalledTimes(1)
    expect(missingConfig).toHaveBeenCalledWith(unknownBlock)
  })
})
