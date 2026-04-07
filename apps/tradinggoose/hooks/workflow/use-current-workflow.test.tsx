/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentWorkflow } from './use-current-workflow'

const mockUseWorkflowDoc = vi.hoisted(() => vi.fn())
const mockUseWorkflowBlocks = vi.hoisted(() => vi.fn())
const mockUseWorkflowEdges = vi.hoisted(() => vi.fn())
const mockUseWorkflowLoops = vi.hoisted(() => vi.fn())
const mockUseWorkflowParallels = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowDoc: mockUseWorkflowDoc,
  useWorkflowBlocks: mockUseWorkflowBlocks,
  useWorkflowEdges: mockUseWorkflowEdges,
  useWorkflowLoops: mockUseWorkflowLoops,
  useWorkflowParallels: mockUseWorkflowParallels,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

describe('useCurrentWorkflow', () => {
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    mockUseWorkflowDoc.mockReset()
    mockUseWorkflowBlocks.mockReset()
    mockUseWorkflowEdges.mockReset()
    mockUseWorkflowLoops.mockReset()
    mockUseWorkflowParallels.mockReset()
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
    }

    root = null
    container?.remove()
    container = null
  })

  afterAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  it('reads workflow state from useWorkflowDoc without mounting the redundant field hooks', async () => {
    mockUseWorkflowDoc.mockReturnValue({
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'script',
          name: 'Script',
          enabled: true,
          position: { x: 0, y: 0 },
          subBlocks: {},
          outputs: {},
        },
      },
      edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
      loops: {},
      parallels: {},
      isDeployed: true,
      deployedAt: '2026-04-06T00:00:00.000Z',
      lastSaved: '2026-04-06T01:00:00.000Z',
    })

    const { useCurrentWorkflow } = await import('./use-current-workflow')

    const currentWorkflowRef: { current: CurrentWorkflow | null } = { current: null }
    function Harness() {
      currentWorkflowRef.current = useCurrentWorkflow()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    expect(mockUseWorkflowDoc).toHaveBeenCalledTimes(1)
    expect(mockUseWorkflowBlocks).not.toHaveBeenCalled()
    expect(mockUseWorkflowEdges).not.toHaveBeenCalled()
    expect(mockUseWorkflowLoops).not.toHaveBeenCalled()
    expect(mockUseWorkflowParallels).not.toHaveBeenCalled()

    expect(currentWorkflowRef.current).not.toBeNull()
    if (!currentWorkflowRef.current) {
      throw new Error('Expected current workflow to be rendered')
    }
    const currentWorkflow = currentWorkflowRef.current

    expect(currentWorkflow.blocks['block-1']?.name).toBe('Script')
    expect(currentWorkflow.getBlockCount()).toBe(1)
    expect(currentWorkflow.getEdgeCount()).toBe(1)
    expect(currentWorkflow.hasBlocks()).toBe(true)
    expect(currentWorkflow.hasEdges()).toBe(true)
    expect(currentWorkflow.isDeployed).toBe(true)
    expect(currentWorkflow.deployedAt?.toISOString()).toBe('2026-04-06T00:00:00.000Z')
    expect(currentWorkflow.lastSaved).toBe(new Date('2026-04-06T01:00:00.000Z').getTime())
  })
})
