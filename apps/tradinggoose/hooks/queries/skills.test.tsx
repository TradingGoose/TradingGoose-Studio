/**
 * @vitest-environment jsdom
 */

import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkills } from '@/hooks/queries/skills'
import { useSkillsStore } from '@/stores/skills/store'

interface ApiSkill {
  id: string
  name: string
  description: string
  content: string
  workspaceId?: string
  userId?: string | null
  createdAt?: string
  updatedAt?: string
}

interface PendingRequest {
  resolve: (response: { ok: boolean; json: () => Promise<{ data: ApiSkill[] }> }) => void
}

function SkillsHarness({ workspaceId }: { workspaceId: string }) {
  useSkills(workspaceId)
  return null
}

function createSkill(overrides: Partial<ApiSkill>): ApiSkill {
  return {
    id: 'skill-1',
    name: 'market-research',
    description: 'Research the market before taking action.',
    content: 'Investigate the market and summarize the setup.',
    ...overrides,
  }
}

describe('useSkills', () => {
  let container: HTMLDivElement
  let root: Root
  let queryClient: QueryClient
  const pendingRequests = new Map<string, PendingRequest[]>()

  const flushAsyncWork = async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const waitFor = async (predicate: () => boolean, timeoutMs = 1000) => {
    const startTime = Date.now()

    while (!predicate()) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error('Timed out waiting for condition')
      }

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }

  const renderHarness = async (workspaceId: string) => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SkillsHarness workspaceId={workspaceId} />
        </QueryClientProvider>
      )
    })

    await act(async () => {
      await flushAsyncWork()
    })
  }

  const resolveWorkspaceRequest = async (workspaceId: string, data: ApiSkill[]) => {
    const queue = pendingRequests.get(workspaceId)
    const nextRequest = queue?.shift()

    if (!nextRequest) {
      throw new Error(`No pending request for workspace ${workspaceId}`)
    }

    if (queue && queue.length === 0) {
      pendingRequests.delete(workspaceId)
    }

    await act(async () => {
      nextRequest.resolve({
        ok: true,
        json: async () => ({ data }),
      })
      await flushAsyncWork()
    })
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    })

    useSkillsStore.getState().resetAll()
    pendingRequests.clear()
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    global.fetch = vi.fn((input) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const url = new URL(rawUrl, 'http://localhost')
      const workspaceId = url.searchParams.get('workspaceId')

      if (!workspaceId) {
        throw new Error('Missing workspaceId in fetch mock')
      }

      return new Promise((resolve) => {
        const queue = pendingRequests.get(workspaceId) ?? []
        queue.push({
          resolve: resolve as PendingRequest['resolve'],
        })
        pendingRequests.set(workspaceId, queue)
      })
    }) as typeof fetch
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    queryClient.clear()
    container.remove()
    useSkillsStore.getState().resetAll()
    vi.restoreAllMocks()
  })

  it('does not sync previous-workspace data into the next workspace bucket while fetching', async () => {
    await renderHarness('workspace-a')
    await resolveWorkspaceRequest('workspace-a', [
      createSkill({
        id: 'skill-a',
        name: 'alpha',
        description: 'Alpha skill',
        content: 'Alpha instructions',
      }),
    ])

    await waitFor(() => useSkillsStore.getState().getAllSkills('workspace-a').length === 1)

    await renderHarness('workspace-b')

    expect(useSkillsStore.getState().getAllSkills('workspace-b')).toEqual([])

    await resolveWorkspaceRequest('workspace-b', [
      createSkill({
        id: 'skill-b',
        name: 'beta',
        description: 'Beta skill',
        content: 'Beta instructions',
      }),
    ])

    await waitFor(() => useSkillsStore.getState().getAllSkills('workspace-b').length === 1)

    expect(
      useSkillsStore
        .getState()
        .getAllSkills('workspace-b')
        .map((skill) => skill.name)
    ).toEqual(['beta'])
  })

  it('syncs the new workspace result even when the skill payload matches the previous workspace', async () => {
    const sharedSkill = createSkill({
      id: 'shared-skill',
      name: 'shared-skill',
      description: 'Shared skill',
      content: 'Shared instructions',
    })

    await renderHarness('workspace-a')
    await resolveWorkspaceRequest('workspace-a', [sharedSkill])

    await renderHarness('workspace-b')

    await resolveWorkspaceRequest('workspace-b', [sharedSkill])

    await waitFor(() => useSkillsStore.getState().getAllSkills('workspace-b').length === 1)

    const workspaceBSkills = useSkillsStore.getState().getAllSkills('workspace-b')
    expect(workspaceBSkills).toHaveLength(1)
    expect(workspaceBSkills[0]?.workspaceId).toBe('workspace-b')
    expect(workspaceBSkills[0]?.name).toBe('shared-skill')
  })
})
