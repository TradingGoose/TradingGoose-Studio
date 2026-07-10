/** @vitest-environment jsdom */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

const mockBootstrapYjsProvider = vi.hoisted(() => vi.fn())

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: mockBootstrapYjsProvider,
}))

vi.mock('@/app/query-provider', () => ({
  getQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/lib/mcp/utils', () => ({
  MCP_TOOLS_CHANGED_EVENT: 'mcp-tools-changed',
}))

vi.mock('@/hooks/queries/custom-tools', () => ({ customToolsKeys: {} }))
vi.mock('@/hooks/queries/knowledge', () => ({ knowledgeKeys: {} }))
vi.mock('@/hooks/queries/skills', () => ({ skillsKeys: {} }))

import type { EntityListMember } from './entity-session'
import { useEntityList } from './use-entity-fields'

type CapturedList = {
  members: EntityListMember[]
  isLoading: boolean
  error: string | null
}

function createMockSession(members: Record<string, { name: string }>) {
  const doc = new Y.Doc()
  doc.transact(() => {
    const map = doc.getMap('members')
    for (const [entityId, value] of Object.entries(members)) {
      map.set(entityId, value)
    }
  })

  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const provider = {
    on: (event: string, handler: (...args: any[]) => void) => {
      const handlers = listeners.get(event) ?? new Set()
      handlers.add(handler)
      listeners.set(event, handlers)
    },
    off: (event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler)
    },
    disconnect: vi.fn(),
    destroy: vi.fn(),
  }

  return {
    doc,
    provider,
    descriptor: {},
    runtime: {},
    accessMode: 'read' as const,
    emit: (event: string) => {
      for (const handler of Array.from(listeners.get(event) ?? [])) {
        handler()
      }
    },
  }
}

let container: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null
const previousActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT

function Harness({
  workspaceId,
  capture,
}: {
  workspaceId: string
  capture: (value: CapturedList) => void
}) {
  const { members, isLoading, error } = useEntityList('skill', workspaceId)
  capture({ members, isLoading, error })
  return null
}

async function renderList(workspaceId: string) {
  const captured: { current: CapturedList | null } = { current: null }
  await act(async () => {
    root!.render(
      <Harness workspaceId={workspaceId} capture={(value) => (captured.current = value)} />
    )
  })
  return captured
}

beforeAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

beforeEach(() => {
  vi.useFakeTimers()
  mockBootstrapYjsProvider.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('useEntityList read-session lifecycle', () => {
  it('replaces the session from a fresh snapshot after connection loss', async () => {
    const stale = createMockSession({ 'id-1': { name: 'Alpha' }, 'id-2': { name: 'Gone' } })
    const fresh = createMockSession({ 'id-1': { name: 'Alpha' } })
    mockBootstrapYjsProvider.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh)

    const captured = await renderList('workspace-reopen')
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Alpha', 'Gone'])

    await act(async () => {
      stale.emit('connection-close')
    })
    expect(stale.provider.destroy).not.toHaveBeenCalled()
    expect(captured.current?.isLoading).toBe(false)
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Alpha', 'Gone'])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(2)
    expect(stale.provider.destroy).toHaveBeenCalledTimes(1)
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Alpha'])
    expect(captured.current?.error).toBeNull()
  })

  it('retries a failed initial open until the session is live', async () => {
    const fresh = createMockSession({ 'id-1': { name: 'Alpha' } })
    mockBootstrapYjsProvider
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(fresh)

    const captured = await renderList('workspace-first-open')
    expect(captured.current?.isLoading).toBe(true)
    expect(captured.current?.error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(2)
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Alpha'])
    expect(captured.current?.error).toBeNull()
  })

  it('keeps retrying failed reopens until the session is live again', async () => {
    const stale = createMockSession({ 'id-1': { name: 'Alpha' } })
    const fresh = createMockSession({ 'id-3': { name: 'Beta' } })
    mockBootstrapYjsProvider
      .mockResolvedValueOnce(stale)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(fresh)

    const captured = await renderList('workspace-retry')
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Alpha'])

    await act(async () => {
      stale.emit('connection-error')
      stale.emit('connection-close')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(2)
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Alpha'])
    expect(captured.current?.error).toBe('offline')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(3)
    expect(captured.current?.members.map((m) => m.entityName)).toEqual(['Beta'])
    expect(captured.current?.error).toBeNull()
  })

  it('stops reopening once the last consumer unmounts', async () => {
    const stale = createMockSession({ 'id-1': { name: 'Alpha' } })
    mockBootstrapYjsProvider.mockResolvedValue(stale)

    await renderList('workspace-release')
    await act(async () => {
      stale.emit('connection-close')
    })
    await act(async () => {
      root!.unmount()
    })
    expect(stale.provider.destroy).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499)
    })
    expect(stale.provider.destroy).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(1)
    expect(stale.provider.destroy).toHaveBeenCalledTimes(1)
  })
})
