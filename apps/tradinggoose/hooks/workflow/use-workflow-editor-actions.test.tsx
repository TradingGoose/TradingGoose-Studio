/** @vitest-environment jsdom */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as Y from 'yjs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkflowTextFieldKey, getWorkflowSnapshot, getWorkflowTextFieldsMap } from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const mockAddBlock = vi.hoisted(() => vi.fn())
const mockUpdateBlockPosition = vi.hoisted(() => vi.fn())
const mockUpdateBlockPositions = vi.hoisted(() => vi.fn())
const mockSession = vi.hoisted(() => ({
  getWorkflowSnapshot: vi.fn(),
}))
const mockUseWorkflowRegistry = vi.hoisted(() =>
  vi.fn((selector: (state: { getActiveWorkflowId: (channelId?: string) => string | null }) => any) =>
    selector({
      getActiveWorkflowId: () => null,
    })
  )
)
const mockWorkflowRoute = vi.hoisted(() => ({
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  channelId: 'default',
}))

vi.mock('@/lib/yjs/use-workflow-doc', () => ({
  useWorkflowMutations: () => ({
    addBlock: mockAddBlock,
    updateBlockPosition: mockUpdateBlockPosition,
    updateBlockPositions: mockUpdateBlockPositions,
  }),
}))

vi.mock('@/lib/yjs/workflow-session-host', () => ({
  useWorkflowSession: () => mockSession,
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: mockUseWorkflowRegistry,
}))

vi.mock('@/widgets/widgets/editor_workflow/context/workflow-route-context', () => ({
  useOptionalWorkflowRoute: () => mockWorkflowRoute,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

describe('useWorkflowEditorActions', () => {
  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    mockAddBlock.mockReset()
    mockUpdateBlockPosition.mockReset()
    mockUpdateBlockPositions.mockReset()
    mockSession.getWorkflowSnapshot.mockReset()
    mockUseWorkflowRegistry.mockClear()
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

  it('duplicates blocks from the materialized live workflow snapshot', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')
    const textFields = getWorkflowTextFieldsMap(doc)

    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'Script',
        enabled: true,
        position: { x: 10, y: 20 },
        data: {},
        layout: {
          measuredHeight: 180,
        },
        height: 0,
        subBlocks: {
          code: {
            id: 'code',
            type: 'code',
            value: 'stale-block-value',
          },
        },
        outputs: {},
      },
    })
    workflowMap.set('edges', [])
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    const sharedText = new Y.Text()
    sharedText.insert(0, 'live-ytext-value')
    textFields.set(createWorkflowTextFieldKey('block-1', 'code'), sharedText)

    mockSession.getWorkflowSnapshot.mockReturnValue(getWorkflowSnapshot(doc))

    const { useWorkflowEditorActions } = await import('./use-workflow-editor-actions')

    let actions: ReturnType<typeof useWorkflowEditorActions> | null = null
    function Harness() {
      actions = useWorkflowEditorActions()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    await act(async () => {
      actions?.collaborativeDuplicateBlock('block-1')
    })

    expect(mockAddBlock).toHaveBeenCalledTimes(1)
    const [, , , , , , , blockProperties] = mockAddBlock.mock.calls[0]
    expect(blockProperties?.height).toBe(180)
    expect(blockProperties?.initialSubBlockValues).toMatchObject({
      code: 'live-ytext-value',
    })
  })

  it('writes block position updates with the requested transaction origin', async () => {
    const doc = new Y.Doc()
    const workflowMap = doc.getMap('workflow')

    workflowMap.set('blocks', {
      'block-1': {
        id: 'block-1',
        type: 'script',
        name: 'Script',
        enabled: true,
        position: { x: 10, y: 20 },
        data: {},
        subBlocks: {},
        outputs: {},
      },
    })
    workflowMap.set('edges', [])
    workflowMap.set('loops', {})
    workflowMap.set('parallels', {})

    mockSession.getWorkflowSnapshot.mockReturnValue(getWorkflowSnapshot(doc))
    mockUpdateBlockPosition.mockImplementation(
      (
        id: string,
        position: { x: number; y: number }
      ) => {
        const blocks = { ...(workflowMap.get('blocks') as Record<string, any>) }
        if (!blocks[id]) {
          return
        }

        blocks[id] = { ...blocks[id], position }
        workflowMap.set('blocks', blocks)
      }
    )

    const { useWorkflowEditorActions } = await import('./use-workflow-editor-actions')

    let actions: ReturnType<typeof useWorkflowEditorActions> | null = null
    function Harness() {
      actions = useWorkflowEditorActions()
      return null
    }

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(React.createElement(Harness))
    })

    await act(async () => {
      actions?.collaborativeUpdateBlockPosition(
        'block-1',
        { x: 30, y: 40 },
        { origin: YJS_ORIGINS.SYSTEM }
      )
    })

    expect(mockUpdateBlockPosition).toHaveBeenCalledWith(
      'block-1',
      { x: 30, y: 40 },
      { origin: YJS_ORIGINS.SYSTEM }
    )
    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.position).toEqual({
      x: 30,
      y: 40,
    })

    await act(async () => {
      actions?.collaborativeUpdateBlockPosition('block-1', { x: 50, y: 60 })
    })

    expect(mockUpdateBlockPosition).toHaveBeenLastCalledWith('block-1', { x: 50, y: 60 }, undefined)
    expect((workflowMap.get('blocks') as Record<string, any>)['block-1']?.position).toEqual({
      x: 50,
      y: 60,
    })
  })
})
