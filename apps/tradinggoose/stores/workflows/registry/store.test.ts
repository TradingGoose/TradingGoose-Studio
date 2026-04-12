import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { WORKSPACE_BOOTSTRAP_CHANNEL, type WorkflowMetadata } from '@/stores/workflows/registry/types'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error?: unknown) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

const createSuccessResponse = (rows: any[]) => {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: rows }),
  }
}

const createErrorResponse = (statusText: string) => {
  return {
    ok: false,
    status: 500,
    statusText,
    json: async () => ({ error: statusText }),
  }
}

const createWorkflowStateResponse = (workflowId: string, blockId: string) => {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      data: {
        id: workflowId,
        state: {
          blocks: {
            [blockId]: {
              id: blockId,
              type: 'agent',
              name: `Block-${blockId}`,
              position: { x: 0, y: 0 },
              subBlocks: {},
              outputs: {},
              enabled: true,
            },
          },
          edges: [],
          loops: {},
          parallels: {},
        },
        isDeployed: false,
      },
    }),
  }
}

const createWorkflowMetadata = (id: string, workspaceId = 'ws-test'): WorkflowMetadata => ({
  id,
  name: id,
  description: id,
  color: '#22c55e',
  createdAt: new Date('2026-03-02T00:00:00.000Z'),
  lastModified: new Date('2026-03-02T00:00:00.000Z'),
  workspaceId,
  folderId: null,
  marketplaceData: null,
})

const resetRegistryState = () => {
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowIds: {},
    loadedWorkflowIds: {},
    hydrationByChannel: {},
    isLoading: false,
    error: null,
    deploymentStatuses: {},
  })
}

describe('workflow registry stale metadata handling', () => {
  beforeEach(() => {
    resetRegistryState()

    ;(globalThis as any).window = {
      location: { origin: 'http://localhost:3000' },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    ;(globalThis as any).CustomEvent = class MockCustomEvent<T = unknown> {
      type: string
      detail: T | undefined
      constructor(type: string, init?: { detail?: T }) {
        this.type = type
        this.detail = init?.detail
      }
    }

    vi.restoreAllMocks()
  })

  it('surfaces unauthorized metadata fetches as registry errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: async () => ({ error: 'Unauthorized' }),
        })
      )
    )

    const channelId = 'workflow-editor-panel'

    await expect(
      useWorkflowRegistry.getState().loadWorkflows({
        workspaceId: 'ws-auth',
        channelId,
      })
    ).rejects.toThrow('Unauthorized')

    const state = useWorkflowRegistry.getState()
    expect(state.workflows).toEqual({})
    expect(state.hydrationByChannel[channelId]?.phase).toBe('error')
    expect(state.hydrationByChannel[channelId]?.error).toContain('Unauthorized')
    expect(state.error).toContain('Unauthorized')
  })

  it('does not apply stale workflow/deployment metadata from an older request', async () => {
    const wsADeferred = createDeferred<any>()
    const wsBDeferred = createDeferred<any>()

    const deferredByWorkspace = new Map<string, Deferred<any>>([
      ['ws-a', wsADeferred],
      ['ws-b', wsBDeferred],
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const url = new URL(rawUrl, 'http://localhost:3000')
        const workspaceId = url.searchParams.get('workspaceId')
        if (!workspaceId) {
          throw new Error('workspaceId is required in metadata request')
        }

        const deferred = deferredByWorkspace.get(workspaceId)
        if (!deferred) {
          throw new Error(`Missing deferred response for ${workspaceId}`)
        }

        return deferred.promise
      })
    )

    const channelId = 'pair-red'
    const firstRequest = useWorkflowRegistry.getState().loadWorkflows({
      workspaceId: 'ws-a',
      channelId,
    })

    const secondRequest = useWorkflowRegistry.getState().loadWorkflows({
      workspaceId: 'ws-b',
      channelId,
    })

    wsBDeferred.resolve(
      createSuccessResponse([
        {
          id: 'wf-b',
          name: 'Workflow B',
          description: 'B',
          color: '#22c55e',
          createdAt: '2026-03-02T00:00:00.000Z',
          workspaceId: 'ws-b',
          isDeployed: false,
        },
      ])
    )

    await secondRequest

    wsADeferred.resolve(
      createSuccessResponse([
        {
          id: 'wf-a',
          name: 'Workflow A',
          description: 'A',
          color: '#ef4444',
          createdAt: '2026-03-01T00:00:00.000Z',
          workspaceId: 'ws-a',
          isDeployed: true,
          deployedAt: '2026-03-01T00:00:00.000Z',
          apiKey: 'stale-api-key',
        },
      ])
    )

    await firstRequest

    const state = useWorkflowRegistry.getState()
    expect(Object.keys(state.workflows)).toEqual(['wf-b'])
    expect(state.workflows['wf-a']).toBeUndefined()
    expect(state.deploymentStatuses['wf-a']).toBeUndefined()
    expect(state.error).toBeNull()
    expect(state.hydrationByChannel[channelId]?.workspaceId).toBe('ws-b')
    expect(state.hydrationByChannel[channelId]?.phase).toBe('metadata-ready')
  })

  it('does not set global error or reject when an outdated request fails', async () => {
    const wsADeferred = createDeferred<any>()
    const wsBDeferred = createDeferred<any>()

    const deferredByWorkspace = new Map<string, Deferred<any>>([
      ['ws-a', wsADeferred],
      ['ws-b', wsBDeferred],
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const url = new URL(rawUrl, 'http://localhost:3000')
        const workspaceId = url.searchParams.get('workspaceId')
        if (!workspaceId) {
          throw new Error('workspaceId is required in metadata request')
        }

        const deferred = deferredByWorkspace.get(workspaceId)
        if (!deferred) {
          throw new Error(`Missing deferred response for ${workspaceId}`)
        }

        return deferred.promise
      })
    )

    const channelId = 'pair-blue'
    const firstRequest = useWorkflowRegistry.getState().loadWorkflows({
      workspaceId: 'ws-a',
      channelId,
    })

    const secondRequest = useWorkflowRegistry.getState().loadWorkflows({
      workspaceId: 'ws-b',
      channelId,
    })

    wsBDeferred.resolve(
      createSuccessResponse([
        {
          id: 'wf-b',
          name: 'Workflow B',
          description: 'B',
          color: '#22c55e',
          createdAt: '2026-03-02T00:00:00.000Z',
          workspaceId: 'ws-b',
          isDeployed: false,
        },
      ])
    )

    await secondRequest

    wsADeferred.resolve(createErrorResponse('Stale metadata failure'))

    await expect(firstRequest).resolves.toBeUndefined()

    const state = useWorkflowRegistry.getState()
    expect(state.error).toBeNull()
    expect(Object.keys(state.workflows)).toEqual(['wf-b'])
    expect(state.hydrationByChannel[channelId]?.phase).toBe('metadata-ready')
    expect(state.hydrationByChannel[channelId]?.workspaceId).toBe('ws-b')
  })

  it('keeps bootstrap metadata aligned during workspace switches so stale previous-workspace loads cannot overwrite the registry', async () => {
    const wsADeferred = createDeferred<any>()
    const wsBDeferred = createDeferred<any>()

    const deferredByWorkspace = new Map<string, Deferred<any>>([
      ['ws-a', wsADeferred],
      ['ws-b', wsBDeferred],
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const url = new URL(rawUrl, 'http://localhost:3000')
        const workspaceId = url.searchParams.get('workspaceId')
        if (!workspaceId) {
          throw new Error('workspaceId is required in metadata request')
        }

        const deferred = deferredByWorkspace.get(workspaceId)
        if (!deferred) {
          throw new Error(`Missing deferred response for ${workspaceId}`)
        }

        return deferred.promise
      })
    )

    useWorkflowRegistry.setState((state) => ({
      ...state,
      workflows: {
        'wf-a': createWorkflowMetadata('wf-a', 'ws-a'),
      },
      hydrationByChannel: {
        'editor-panel': {
          phase: 'ready',
          workspaceId: 'ws-a',
          workflowId: 'wf-a',
          requestId: null,
          error: null,
        },
      },
    }))

    const staleBootstrapRequest = useWorkflowRegistry.getState().loadWorkflows({
      workspaceId: 'ws-a',
      channelId: WORKSPACE_BOOTSTRAP_CHANNEL,
    })

    const switchPromise = useWorkflowRegistry.getState().switchToWorkspace('ws-b')

    wsBDeferred.resolve(
      createSuccessResponse([
        {
          id: 'wf-b',
          name: 'Workflow B',
          description: 'B',
          color: '#22c55e',
          createdAt: '2026-03-02T00:00:00.000Z',
          workspaceId: 'ws-b',
          isDeployed: false,
        },
      ])
    )

    await switchPromise

    wsADeferred.resolve(
      createSuccessResponse([
        {
          id: 'wf-a',
          name: 'Workflow A',
          description: 'A',
          color: '#ef4444',
          createdAt: '2026-03-01T00:00:00.000Z',
          workspaceId: 'ws-a',
          isDeployed: false,
        },
      ])
    )

    await staleBootstrapRequest

    const state = useWorkflowRegistry.getState()
    expect(Object.keys(state.workflows)).toEqual(['wf-b'])
    expect(state.hydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL]?.workspaceId).toBe('ws-b')
    expect(state.hydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL]?.phase).toBe('metadata-ready')
  })

  it('supports concurrent setActiveWorkflow calls on different channels', async () => {
    const wfA = 'wf-concurrent-a'
    const wfB = 'wf-concurrent-b'
    const channelA = 'channel-a'
    const channelB = 'channel-b'

    const wfADeferred = createDeferred<any>()
    const wfBDeferred = createDeferred<any>()

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const url = new URL(rawUrl, 'http://localhost:3000')
        const workflowId = url.pathname.split('/').pop()

        if (workflowId === wfA) {
          return wfADeferred.promise
        }
        if (workflowId === wfB) {
          return wfBDeferred.promise
        }

        throw new Error(`Unexpected workflow request: ${url.pathname}`)
      })
    )

    useWorkflowRegistry.setState((state) => ({
      ...state,
      workflows: {
        [wfA]: createWorkflowMetadata(wfA, 'ws-a'),
        [wfB]: createWorkflowMetadata(wfB, 'ws-b'),
      },
      activeWorkflowIds: {},
      loadedWorkflowIds: {},
      hydrationByChannel: {},
      error: null,
    }))

    const setA = useWorkflowRegistry.getState().setActiveWorkflow({
      workflowId: wfA,
      channelId: channelA,
    })
    const setB = useWorkflowRegistry.getState().setActiveWorkflow({
      workflowId: wfB,
      channelId: channelB,
    })

    wfBDeferred.resolve(createWorkflowStateResponse(wfB, 'block-b'))
    wfADeferred.resolve(createWorkflowStateResponse(wfA, 'block-a'))

    await Promise.all([setA, setB])

    const state = useWorkflowRegistry.getState()
    expect(state.activeWorkflowIds[channelA]).toBe(wfA)
    expect(state.activeWorkflowIds[channelB]).toBe(wfB)
    expect(state.loadedWorkflowIds[channelA]).toBe(true)
    expect(state.loadedWorkflowIds[channelB]).toBe(true)
    expect(state.hydrationByChannel[channelA]?.phase).toBe('ready')
    expect(state.hydrationByChannel[channelB]?.phase).toBe('ready')
  })

  it('keeps only newest same-channel setActiveWorkflow result when responses finish out of order', async () => {
    const wfOld = 'wf-race-old'
    const wfNew = 'wf-race-new'
    const channel = 'channel-main'

    const wfOldDeferred = createDeferred<any>()
    const wfNewDeferred = createDeferred<any>()

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const rawUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const url = new URL(rawUrl, 'http://localhost:3000')
        const workflowId = url.pathname.split('/').pop()

        if (workflowId === wfOld) {
          return wfOldDeferred.promise
        }
        if (workflowId === wfNew) {
          return wfNewDeferred.promise
        }

        throw new Error(`Unexpected workflow request: ${url.pathname}`)
      })
    )

    useWorkflowRegistry.setState((state) => ({
      ...state,
      workflows: {
        [wfOld]: createWorkflowMetadata(wfOld, 'ws-main'),
        [wfNew]: createWorkflowMetadata(wfNew, 'ws-main'),
      },
      activeWorkflowIds: {},
      loadedWorkflowIds: {},
      hydrationByChannel: {},
      error: null,
    }))

    const first = useWorkflowRegistry.getState().setActiveWorkflow({
      workflowId: wfOld,
      channelId: channel,
    })

    const second = useWorkflowRegistry.getState().setActiveWorkflow({
      workflowId: wfNew,
      channelId: channel,
    })

    wfNewDeferred.resolve(createWorkflowStateResponse(wfNew, 'block-new'))
    await second

    wfOldDeferred.resolve(createWorkflowStateResponse(wfOld, 'block-old'))
    await first

    const state = useWorkflowRegistry.getState()
    expect(state.activeWorkflowIds[channel]).toBe(wfNew)
    expect(state.loadedWorkflowIds[channel]).toBe(true)
    expect(state.hydrationByChannel[channel]?.phase).toBe('ready')
    expect(state.hydrationByChannel[channel]?.workflowId).toBe(wfNew)
    expect(state.error).toBeNull()
  })
})
