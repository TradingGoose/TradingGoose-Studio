import { devtools } from 'zustand/middleware'
import { createWithEqualityFn as create } from 'zustand/traditional'
import { getStableVibrantColor } from '@/lib/colors'
import { createLogger } from '@/lib/logs/console/logger'
import { generateCreativeWorkflowName } from '@/lib/naming'
import { API_ENDPOINTS } from '@/stores/constants'
import { usePairColorStore } from '@/stores/dashboard/pair-store'
import type {
  ChannelHydrationState,
  DeploymentStatus,
  WorkflowMetadata,
  WorkflowMetadataSeed,
  WorkflowRegistry,
} from '@/stores/workflows/registry/types'
import { WORKSPACE_BOOTSTRAP_CHANNEL } from '@/stores/workflows/registry/types'
import { isPairColor, type PAIR_COLORS, type PairColor } from '@/widgets/pair-colors'

const logger = createLogger('WorkflowRegistry')

const DEFAULT_WORKFLOW_CHANNEL_ID = 'default'

const resolveChannelKey = (channelId?: string) =>
  channelId && channelId.trim().length > 0 ? channelId : DEFAULT_WORKFLOW_CHANNEL_ID

const createIdleHydrationState = (): ChannelHydrationState => ({
  phase: 'idle',
  workspaceId: null,
  workflowId: null,
  requestId: null,
  error: null,
})

const createMetadataLoadingHydrationState = (
  workspaceId: string,
  requestId: string
): ChannelHydrationState => ({
  phase: 'metadata-loading',
  workspaceId,
  workflowId: null,
  requestId,
  error: null,
})

const createMetadataReadyHydrationState = (
  workspaceId: string | null,
  workflowId: string | null
): ChannelHydrationState => ({
  phase: 'metadata-ready',
  workspaceId,
  workflowId,
  requestId: null,
  error: null,
})

const createStateLoadingHydrationState = (
  workspaceId: string | null,
  workflowId: string,
  requestId: string
): ChannelHydrationState => ({
  phase: 'state-loading',
  workspaceId,
  workflowId,
  requestId,
  error: null,
})

const createReadyHydrationState = (
  workspaceId: string | null,
  workflowId: string
): ChannelHydrationState => ({
  phase: 'ready',
  workspaceId,
  workflowId,
  requestId: null,
  error: null,
})

const createErrorHydrationState = (
  workspaceId: string | null,
  workflowId: string | null,
  error: string
): ChannelHydrationState => ({
  phase: 'error',
  workspaceId,
  workflowId,
  requestId: null,
  error,
})

const deriveIsMetadataLoading = (
  hydrationByChannel: Record<string, ChannelHydrationState>
): boolean =>
  Object.values(hydrationByChannel).some((hydration) => hydration.phase === 'metadata-loading')

const getRealHydrationChannels = (hydrationByChannel: Record<string, ChannelHydrationState>) =>
  Object.keys(hydrationByChannel).filter((channelKey) => channelKey !== WORKSPACE_BOOTSTRAP_CHANNEL)

const getPairColorFromChannelId = (channelId?: string): PairColor | null => {
  if (!channelId) return null
  const prefix = 'pair-'
  if (!channelId.startsWith(prefix)) return null
  const color = channelId.slice(prefix.length) as (typeof PAIR_COLORS)[number]
  return isPairColor(color) ? color : null
}

const syncPairContextForChannel = (channelId: string | undefined, workflowId: string | null) => {
  const pairColor = getPairColorFromChannelId(channelId)
  if (!pairColor) return
  const { setContext } = usePairColorStore.getState()
  setContext(pairColor, { workflowId: workflowId ?? undefined })
}

const syncRegistryFromPairContexts = (
  contexts: ReturnType<typeof usePairColorStore.getState>['contexts']
) => {
  const updates: Record<string, string> = {}
  const removals = new Set<string>()

  Object.entries(contexts).forEach(([color, ctx]) => {
    if (color === 'gray') return
    const channelId = `pair-${color}`
    if (ctx?.workflowId) {
      updates[channelId] = ctx.workflowId
    } else {
      removals.add(channelId)
    }
  })

  useWorkflowRegistry.setState((state) => {
    const nextActiveWorkflowIds = { ...state.activeWorkflowIds }
    const nextLoadedWorkflowIds = { ...state.loadedWorkflowIds }
    const nextHydrationByChannel = { ...state.hydrationByChannel }

    removals.forEach((chan) => {
      delete nextActiveWorkflowIds[chan]
      delete nextLoadedWorkflowIds[chan]
      nextHydrationByChannel[chan] = createIdleHydrationState()
    })

    Object.entries(updates).forEach(([chan, wfId]) => {
      const previousActive = state.activeWorkflowIds[chan]
      const previousHydration = state.hydrationByChannel[chan]
      const workspaceId =
        state.workflows[wfId]?.workspaceId ?? previousHydration?.workspaceId ?? null
      nextActiveWorkflowIds[chan] = wfId

      // Only reset the loaded flag when the workflow changed; keep it when linking the same one
      if (previousActive === wfId && state.loadedWorkflowIds[chan]) {
        nextLoadedWorkflowIds[chan] = state.loadedWorkflowIds[chan]
        nextHydrationByChannel[chan] =
          previousHydration ?? createReadyHydrationState(workspaceId, wfId)
      } else {
        nextLoadedWorkflowIds[chan] = false
        nextHydrationByChannel[chan] = createMetadataReadyHydrationState(workspaceId, wfId)
      }
    })

    return {
      ...state,
      activeWorkflowIds: nextActiveWorkflowIds,
      loadedWorkflowIds: nextLoadedWorkflowIds,
      hydrationByChannel: nextHydrationByChannel,
      isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
    }
  })
}

const getActiveWorkflowIdFromState = (
  state: WorkflowRegistry,
  channelId?: string
): string | null => {
  const channelKey = resolveChannelKey(channelId)
  return state.loadedWorkflowIds[channelKey] ? (state.activeWorkflowIds[channelKey] ?? null) : null
}

const getHydrationFromState = (
  state: WorkflowRegistry,
  channelId?: string
): ChannelHydrationState =>
  state.hydrationByChannel[resolveChannelKey(channelId)] ?? createIdleHydrationState()

const metadataRequestCache = new Map<string, Promise<any[]>>()

async function fetchWorkflowMetadata(workspaceId: string): Promise<any[]> {
  if (typeof window === 'undefined') return []

  const requestKey = workspaceId
  if (metadataRequestCache.has(requestKey)) {
    logger.info(`Reusing in-flight metadata request for workspace ${workspaceId}`)
    return metadataRequestCache.get(requestKey)!
  }

  const requestPromise = (async () => {
    const url = new URL(API_ENDPOINTS.WORKFLOWS, window.location.origin)
    url.searchParams.set('workspaceId', workspaceId)
    const response = await fetch(url.toString(), { method: 'GET' })

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const authError = response.status === 401 ? 'Unauthorized' : 'Forbidden'
        logger.warn(`Workflow metadata fetch authorization failure: ${authError}`, {
          workspaceId,
          status: response.status,
        })
        throw new Error(authError)
      }
      throw new Error(`Failed to fetch workflows: ${response.statusText}`)
    }

    const { data } = await response.json()
    return Array.isArray(data) ? data : []
  })().finally(() => {
    metadataRequestCache.delete(requestKey)
  })

  metadataRequestCache.set(requestKey, requestPromise)
  return requestPromise
}

const mapRegistryMetadata = (rows: any[]) => {
  const workflows: Record<string, WorkflowMetadata> = {}
  const deploymentStatuses: Record<string, DeploymentStatus> = {}

  rows.forEach((workflow) => {
    const {
      id,
      name,
      description,
      color,
      createdAt,
      workspaceId,
      folderId,
      isDeployed,
      deployedAt,
      apiKey,
    } = workflow

    workflows[id] = {
      id,
      name,
      description: description || '',
      color: color || getStableVibrantColor(id),
      lastModified: createdAt ? new Date(createdAt) : new Date(),
      createdAt: createdAt ? new Date(createdAt) : new Date(),
      workspaceId,
      folderId: folderId || null,
    }

    if (isDeployed || deployedAt) {
      deploymentStatuses[id] = {
        isDeployed: isDeployed || false,
        deployedAt: deployedAt ? new Date(deployedAt) : undefined,
        apiKey: apiKey || undefined,
        needsRedeployment: false,
      }
    }
  })

  return { workflows, deploymentStatuses }
}

// Track workspace transitions to prevent race conditions
let isWorkspaceTransitioning = false
const TRANSITION_TIMEOUT = 5000 // 5 seconds maximum for workspace transitions

/**
 * Handles workspace transition state tracking
 * @param isTransitioning Whether workspace is currently transitioning
 */
function setWorkspaceTransitioning(isTransitioning: boolean): void {
  isWorkspaceTransitioning = isTransitioning

  // Set a safety timeout to prevent permanently stuck in transition state
  if (isTransitioning) {
    setTimeout(() => {
      if (isWorkspaceTransitioning) {
        logger.warn('Forcing workspace transition to complete due to timeout')
        isWorkspaceTransitioning = false
      }
    }, TRANSITION_TIMEOUT)
  }
}

/**
 * Checks if workspace is currently in transition
 * @returns True if workspace is transitioning
 */
export function isWorkspaceInTransition(): boolean {
  return isWorkspaceTransitioning
}

/**
 * Checks if workflows have been initially loaded
 * @returns True if the initial workflow load has completed at least once
 */
export function hasWorkflowsInitiallyLoaded(): boolean {
  return hasInitiallyLoaded
}

// Track if initial load has happened to prevent premature navigation
let hasInitiallyLoaded = false

// Map to track in-flight requests for deduplication
const pendingRequests = new Map<string, Promise<any>>()

async function fetchWorkflowData(id: string): Promise<any> {
  // Check for pending request
  if (pendingRequests.has(id)) {
    logger.info(`Reusing in-flight request for workflow ${id}`)
    return pendingRequests.get(id)
  }

  // Create new request
  const promise = (async () => {
    try {
      const response = await fetch(`/api/workflows/${id}`, { method: 'GET' })
      if (!response.ok) {
        throw new Error(`Failed to fetch workflow: ${response.statusText}`)
      }
      const { data } = await response.json()
      return data
    } finally {
      // Remove from pending requests
      pendingRequests.delete(id)
    }
  })()

  pendingRequests.set(id, promise)
  return promise
}

export const useWorkflowRegistry = create<WorkflowRegistry>()(
  devtools(
    (set, get) => ({
      // Store state
      workflows: {},
      activeWorkflowIds: {},
      loadedWorkflowIds: {},
      hydrationByChannel: {},
      isLoading: false,
      error: null,
      deploymentStatuses: {},

      getActiveWorkflowId: (channelId?: string) => {
        return getActiveWorkflowIdFromState(get(), channelId)
      },

      getHydration: (channelId?: string) => {
        return getHydrationFromState(get(), channelId)
      },

      isChannelHydrating: (channelId?: string) => {
        const phase = getHydrationFromState(get(), channelId).phase
        return phase === 'metadata-loading' || phase === 'state-loading'
      },

      getLoadedChannelsForWorkflow: (workflowId: string) => {
        const state = get()
        return Object.entries(state.activeWorkflowIds)
          .filter(([channelKey, activeWorkflowId]) => {
            return activeWorkflowId === workflowId && state.loadedWorkflowIds[channelKey] === true
          })
          .map(([channelKey]) => channelKey)
      },

      getPrimaryLoadedChannelForWorkflow: (workflowId: string) => {
        const loadedChannels = get().getLoadedChannelsForWorkflow(workflowId)
        return loadedChannels[0] ?? null
      },

      loadWorkflows: async ({
        workspaceId,
        channelId,
      }: {
        workspaceId: string
        channelId?: string
      }) => {
        const trimmedWorkspaceId = workspaceId.trim()
        if (!trimmedWorkspaceId) {
          throw new Error('workspaceId is required')
        }

        const targetChannels = (() => {
          if (channelId) {
            return [resolveChannelKey(channelId)]
          }

          const realChannels = getRealHydrationChannels(get().hydrationByChannel)
          return realChannels.length > 0
            ? [...realChannels, WORKSPACE_BOOTSTRAP_CHANNEL]
            : [WORKSPACE_BOOTSTRAP_CHANNEL]
        })()

        const requestId = crypto.randomUUID()

        set((state) => {
          const nextHydrationByChannel = { ...state.hydrationByChannel }
          targetChannels.forEach((target) => {
            nextHydrationByChannel[target] = createMetadataLoadingHydrationState(
              trimmedWorkspaceId,
              requestId
            )
          })
          return {
            hydrationByChannel: nextHydrationByChannel,
            isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
            error: null,
          }
        })

        try {
          const rows = await fetchWorkflowMetadata(trimmedWorkspaceId)
          const hasCurrentTarget = targetChannels.some((target) => {
            const currentHydration = get().hydrationByChannel[target]
            return currentHydration?.requestId === requestId
          })

          if (!hasCurrentTarget) {
            logger.info('Discarded stale workflow metadata response before apply', {
              workspaceId: trimmedWorkspaceId,
              requestId,
              targetChannels,
            })
            return
          }

          const { workflows, deploymentStatuses } = mapRegistryMetadata(rows)
          let applied = false

          set((state) => {
            const nextHydrationByChannel = { ...state.hydrationByChannel }
            let matchedTargets = 0

            targetChannels.forEach((target) => {
              const currentHydration = nextHydrationByChannel[target]
              if (!currentHydration || currentHydration.requestId !== requestId) {
                return
              }

              matchedTargets += 1
              nextHydrationByChannel[target] = createMetadataReadyHydrationState(
                trimmedWorkspaceId,
                currentHydration.workflowId
              )
            })

            if (matchedTargets === 0) {
              return {}
            }

            applied = true

            return {
              workflows,
              deploymentStatuses,
              hydrationByChannel: nextHydrationByChannel,
              isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
              error: null,
            }
          })

          if (!applied) {
            logger.info('Discarded stale workflow metadata response during apply', {
              workspaceId: trimmedWorkspaceId,
              requestId,
              targetChannels,
            })
            return
          }

          hasInitiallyLoaded = true
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          let applied = false

          set((state) => {
            const nextHydrationByChannel = { ...state.hydrationByChannel }
            let matchedTargets = 0

            targetChannels.forEach((target) => {
              const currentHydration = nextHydrationByChannel[target]
              if (!currentHydration || currentHydration.requestId !== requestId) {
                return
              }

              matchedTargets += 1
              nextHydrationByChannel[target] = createErrorHydrationState(
                trimmedWorkspaceId,
                currentHydration.workflowId,
                message
              )
            })

            if (matchedTargets === 0) {
              return {}
            }

            applied = true

            return {
              hydrationByChannel: nextHydrationByChannel,
              isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
              error: `Failed to load workflows: ${message}`,
            }
          })

          if (!applied) {
            logger.info('Discarded stale workflow metadata error response', {
              workspaceId: trimmedWorkspaceId,
              requestId,
              targetChannels,
              message,
            })
            return
          }

          hasInitiallyLoaded = true
          throw error
        }
      },

      switchToWorkspace: async (workspaceId: string) => {
        // Prevent multiple simultaneous transitions
        if (isWorkspaceTransitioning) {
          logger.warn(
            `Ignoring workspace switch to ${workspaceId} - transition already in progress`
          )
          return
        }

        // Set transition flag
        setWorkspaceTransitioning(true)

        try {
          logger.info(`Switching to workspace: ${workspaceId}`)

          // Reset the initial load flag when switching workspaces
          hasInitiallyLoaded = false

          // Clear current workspace state
          set((state) => {
            const existingHydration = state.hydrationByChannel
            const realChannels = getRealHydrationChannels(existingHydration)
            const nextHydrationByChannel: Record<string, ChannelHydrationState> = {}

            if (realChannels.length > 0) {
              realChannels.forEach((channelKey) => {
                const currentHydration = existingHydration[channelKey]
                nextHydrationByChannel[channelKey] = createMetadataLoadingHydrationState(
                  workspaceId,
                  currentHydration?.requestId ?? crypto.randomUUID()
                )
                nextHydrationByChannel[channelKey].workflowId = currentHydration?.workflowId ?? null
              })
            } else {
              nextHydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL] =
                createMetadataLoadingHydrationState(workspaceId, crypto.randomUUID())
            }

            return {
              loadedWorkflowIds: {},
              activeWorkflowIds: {},
              workflows: {},
              deploymentStatuses: {},
              hydrationByChannel: nextHydrationByChannel,
              isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
              error: null,
            }
          })

          await get().loadWorkflows({ workspaceId })

          logger.info(`Successfully switched to workspace: ${workspaceId}`)
        } catch (error) {
          logger.error(`Error switching to workspace ${workspaceId}:`, { error })
          set({
            error: `Failed to switch workspace: ${error instanceof Error ? error.message : 'Unknown error'}`,
            isLoading: false,
          })
        } finally {
          setWorkspaceTransitioning(false)
        }
      },

      // Method to get deployment status for a specific workflow
      readWorkflowDeploymentStatus: (workflowId: string | null): DeploymentStatus | null => {
        if (!workflowId) {
          // If no workflow ID provided, check the active workflow
          workflowId = getActiveWorkflowIdFromState(get())
          if (!workflowId) return null
        }

        const { deploymentStatuses = {} } = get()

        // Get from the workflow-specific deployment statuses in the registry
        if (deploymentStatuses[workflowId]) {
          return deploymentStatuses[workflowId]
        }

        // No deployment status found
        return null
      },

      // Method to set deployment status for a specific workflow
      setDeploymentStatus: (
        workflowId: string | null,
        isDeployed: boolean,
        deployedAt?: Date,
        apiKey?: string
      ) => {
        if (!workflowId) {
          workflowId = getActiveWorkflowIdFromState(get())
          if (!workflowId) return
        }

        // Update the deployment statuses in the registry
        set((state) => ({
          deploymentStatuses: {
            ...state.deploymentStatuses,
            [workflowId as string]: {
              isDeployed,
              deployedAt: deployedAt || (isDeployed ? new Date() : undefined),
              apiKey,
              // Preserve existing needsRedeployment flag if available, but reset if newly deployed
              needsRedeployment: isDeployed
                ? false
                : ((state.deploymentStatuses?.[workflowId as string] as any)?.needsRedeployment ??
                  false),
            },
          },
        }))

        // Note: Socket.IO handles real-time sync automatically
      },

      // Method to set the needsRedeployment flag for a specific workflow
      setWorkflowNeedsRedeployment: (workflowId: string | null, needsRedeployment: boolean) => {
        if (!workflowId) {
          workflowId = getActiveWorkflowIdFromState(get())
          if (!workflowId) return
        }

        // Update the registry's deployment status for this specific workflow
        set((state) => {
          const deploymentStatuses = state.deploymentStatuses || {}
          const currentStatus = deploymentStatuses[workflowId as string] || { isDeployed: false }

          return {
            deploymentStatuses: {
              ...deploymentStatuses,
              [workflowId as string]: {
                ...currentStatus,
                needsRedeployment,
              },
            },
          }
        })

        // Note: needsRedeployment is now computed server-side via /api/workflows/{id}/status
      },

      setActiveWorkflow: async ({
        workflowId,
        channelId,
      }: {
        workflowId: string
        channelId?: string
      }) => {
        const channelKey = resolveChannelKey(channelId)
        const state = get()
        const workflowMetadata = state.workflows[workflowId]
        const activeWorkflowIdForChannel = getActiveWorkflowIdFromState(state, channelKey)
        const hydration = getHydrationFromState(state, channelKey)

        const shouldSkip =
          activeWorkflowIdForChannel === workflowId &&
          state.loadedWorkflowIds[channelKey] === true &&
          hydration.phase === 'ready'

        if (shouldSkip) {
          logger.info(
            `Already active workflow ${workflowId} on channel ${channelKey}, skipping switch`
          )
          return
        }

        const requestId = crypto.randomUUID()
        const workspaceId = workflowMetadata?.workspaceId ?? hydration.workspaceId ?? null

        set((current) => {
          const nextHydrationByChannel: Record<string, ChannelHydrationState> = {
            ...current.hydrationByChannel,
            [channelKey]: createStateLoadingHydrationState(workspaceId, workflowId, requestId),
          }

          if (
            channelKey !== WORKSPACE_BOOTSTRAP_CHANNEL &&
            nextHydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL]
          ) {
            delete nextHydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL]
          }

          return {
            hydrationByChannel: nextHydrationByChannel,
            isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
            error: null,
          }
        })

        logger.info(`Switching to workflow ${workflowId}`)

        let workflowData: any
        try {
          workflowData = await fetchWorkflowData(workflowId)
        } catch (error) {
          logger.error(`Failed to fetch workflow data for ${workflowId}:`, error)
          const message =
            error instanceof Error ? error.message : `Failed to load workflow: ${workflowId}`
          set((current) => {
            const currentHydration = current.hydrationByChannel[channelKey]
            if (!currentHydration || currentHydration.requestId !== requestId) {
              return {}
            }

            const nextHydrationByChannel = {
              ...current.hydrationByChannel,
              [channelKey]: createErrorHydrationState(workspaceId, workflowId, message),
            }

            return {
              hydrationByChannel: nextHydrationByChannel,
              isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
              error: message,
            }
          })
          throw error
        }

        const latestHydration = get().hydrationByChannel[channelKey]
        if (
          !latestHydration ||
          latestHydration.requestId !== requestId ||
          latestHydration.workflowId !== workflowId
        ) {
          logger.info(`Discarded stale workflow state response for ${workflowId} on ${channelKey}`)
          return
        }

        let workflowState: any
        if (workflowData?.state) {
          workflowState = {
            blocks: workflowData.state.blocks || {},
            edges: workflowData.state.edges || [],
            loops: workflowData.state.loops || {},
            parallels: workflowData.state.parallels || {},
            isDeployed: workflowData.isDeployed || false,
            deployedAt: workflowData.deployedAt ? new Date(workflowData.deployedAt) : undefined,
            apiKey: workflowData.apiKey,
            lastSaved: Date.now(),
            deploymentStatuses: {},
          }
        } else {
          workflowState = {
            blocks: {},
            edges: [],
            loops: {},
            parallels: {},
            isDeployed: false,
            deployedAt: undefined,
            deploymentStatuses: {},
            lastSaved: Date.now(),
          }

          logger.warn(
            `Workflow ${workflowId} has no state in DB - this should not happen with server-side trigger block creation`
          )
        }

        set((current) => {
          const currentHydration = current.hydrationByChannel[channelKey]
          if (
            !currentHydration ||
            currentHydration.requestId !== requestId ||
            currentHydration.workflowId !== workflowId
          ) {
            return {}
          }

          const { workflows: fetchedWorkflows, deploymentStatuses: fetchedDeploymentStatuses } =
            mapRegistryMetadata([workflowData])
          const fetchedWorkflow = fetchedWorkflows[workflowData.id ?? workflowId]
          const resolvedWorkspaceId = fetchedWorkflow?.workspaceId ?? workspaceId
          const nextHydrationByChannel: Record<string, ChannelHydrationState> = {
            ...current.hydrationByChannel,
            [channelKey]: createReadyHydrationState(resolvedWorkspaceId, workflowId),
          }

          if (
            channelKey !== WORKSPACE_BOOTSTRAP_CHANNEL &&
            nextHydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL]
          ) {
            delete nextHydrationByChannel[WORKSPACE_BOOTSTRAP_CHANNEL]
          }

          return {
            workflows: {
              ...current.workflows,
              ...(fetchedWorkflow ? { [workflowId]: fetchedWorkflow } : {}),
            },
            activeWorkflowIds: {
              ...current.activeWorkflowIds,
              [channelKey]: workflowId,
            },
            loadedWorkflowIds: {
              ...current.loadedWorkflowIds,
              [channelKey]: true,
            },
            deploymentStatuses: {
              ...current.deploymentStatuses,
              ...fetchedDeploymentStatuses,
            },
            hydrationByChannel: nextHydrationByChannel,
            isLoading: deriveIsMetadataLoading(nextHydrationByChannel),
            error: null,
          }
        })

        syncPairContextForChannel(channelKey, workflowId)

        window.dispatchEvent(
          new CustomEvent('active-workflow-changed', {
            detail: { workflowId, channelId: channelKey },
          })
        )

        logger.info(`Switched to workflow ${workflowId}`)
      },

      /**
       * Creates a new workflow with appropriate metadata and initial blocks
       * @param options - Optional configuration for workflow creation
       * @returns The ID of the newly created workflow
       */
      createWorkflow: async (options = {}) => {
        // Use provided workspace ID (must be provided since we no longer track active workspace)
        const workspaceId = options.workspaceId

        if (!workspaceId) {
          logger.error('Cannot create workflow without workspaceId')
          set({ error: 'Workspace ID is required to create a workflow' })
          throw new Error('Workspace ID is required to create a workflow')
        }

        logger.info(`Creating new workflow in workspace: ${workspaceId}`)

        // Create the workflow on the server first to get the server-generated ID
        try {
          const requestBody: Record<string, unknown> = {
            name: options.name || generateCreativeWorkflowName(),
            description: options.description ?? 'New workflow',
            workspaceId,
            folderId: options.folderId || null,
            ...(options.initialWorkflowState === undefined
              ? {}
              : { initialWorkflowState: options.initialWorkflowState }),
          }

          const response = await fetch('/api/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(`Failed to create workflow: ${errorData.error || response.statusText}`)
          }

          const createdWorkflow = await response.json()
          const serverWorkflowId = createdWorkflow.id

          logger.info(`Successfully created workflow ${serverWorkflowId} on server`)

          // Generate workflow metadata with server-generated ID
          const newWorkflow: WorkflowMetadata = {
            id: serverWorkflowId,
            name: createdWorkflow.name,
            lastModified: new Date(),
            createdAt: new Date(),
            description: createdWorkflow.description,
            color: createdWorkflow.color,
            workspaceId,
            folderId: createdWorkflow.folderId,
          }

          // Add workflow to registry with server-generated ID
          set((state) => ({
            workflows: {
              ...state.workflows,
              [serverWorkflowId]: newWorkflow,
            },
            error: null,
          }))

          // Don't set as active workflow here - let the navigation/URL change handle that
          // This prevents race conditions and flickering
          logger.info(
            `Created new workflow with ID ${serverWorkflowId} in workspace ${workspaceId}`
          )

          return serverWorkflowId
        } catch (error) {
          logger.error(`Failed to create new workflow:`, error)
          set({
            error: `Failed to create workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          })
          throw error
        }
      },

      /**
       * Duplicates an existing workflow
       */
      duplicateWorkflow: async (sourceId: string, source?: WorkflowMetadataSeed) => {
        const { workflows } = get()
        const sourceWorkflow = source ?? workflows[sourceId]

        if (!sourceWorkflow) {
          set({ error: `Workflow ${sourceId} not found` })
          return null
        }

        const workspaceId = sourceWorkflow.workspaceId
        if (!workspaceId) {
          set({ error: 'Workspace ID is required to duplicate a workflow' })
          return null
        }

        // Call the server to duplicate the workflow - server generates all IDs
        let duplicatedWorkflow
        try {
          const response = await fetch(`/api/workflows/${sourceId}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `${sourceWorkflow.name} (Copy)`,
              description: sourceWorkflow.description,
              workspaceId,
              folderId: sourceWorkflow.folderId,
            }),
          })

          if (!response.ok) {
            throw new Error(`Failed to duplicate workflow: ${response.statusText}`)
          }

          duplicatedWorkflow = await response.json()
          logger.info(
            `Successfully duplicated workflow ${sourceId} to ${duplicatedWorkflow.id} with ${duplicatedWorkflow.blocksCount} blocks, ${duplicatedWorkflow.edgesCount} edges, ${duplicatedWorkflow.subflowsCount} subflows`
          )
        } catch (error) {
          logger.error(`Failed to duplicate workflow ${sourceId}:`, error)
          set({
            error: `Failed to duplicate workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          })
          return null
        }

        // Use the server-generated ID
        const id = duplicatedWorkflow.id

        // Generate new workflow metadata using the server-generated ID
        const newWorkflow: WorkflowMetadata = {
          id,
          name: duplicatedWorkflow.name ?? `${sourceWorkflow.name} (Copy)`,
          lastModified: new Date(),
          createdAt: new Date(),
          description: duplicatedWorkflow.description ?? sourceWorkflow.description,
          color: duplicatedWorkflow.color || getStableVibrantColor(id),
          workspaceId, // Include the workspaceId in the new workflow
          folderId: duplicatedWorkflow.folderId ?? sourceWorkflow.folderId, // Include the folderId from source workflow
        }

        // Add workflow to registry
        set((state) => ({
          workflows: {
            ...state.workflows,
            [id]: newWorkflow,
          },
          error: null,
        }))
        logger.info(`Duplicated workflow ${sourceId} to ${id} in workspace ${workspaceId}`)

        return id
      },

      // Delete workflow and clean up associated storage
      removeWorkflow: async (id: string, options?: { skipApi?: boolean }) => {
        const skipApi = options?.skipApi ?? false
        set({ error: null })

        if (!skipApi) {
          try {
            const response = await fetch(`/api/workflows/${id}`, {
              method: 'DELETE',
            })

            if (!response.ok) {
              const error = await response.json().catch(() => ({ error: 'Unknown error' }))
              throw new Error(error.error || 'Failed to delete workflow')
            }

            logger.info(`Successfully deleted workflow ${id} from database`)
          } catch (error) {
            logger.error(`Failed to delete workflow ${id} from database:`, error)
            set({
              error: `Failed to delete workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
            })
            return
          }
        }

        let clearedActiveWorkflow = false

        // Update local state after deletion
        set((state) => {
          const newWorkflows = { ...state.workflows }
          delete newWorkflows[id]

          // If deleting active workflow, clear active workflow ID immediately
          // Don't automatically switch to another workflow to prevent race conditions
          const newActiveWorkflowIds = { ...state.activeWorkflowIds }
          const newLoadedWorkflowIds = { ...state.loadedWorkflowIds }
          const newHydrationByChannel = { ...state.hydrationByChannel }

          Object.entries(newActiveWorkflowIds).forEach(([channel, activeId]) => {
            if (activeId === id) {
              delete newActiveWorkflowIds[channel]
              delete newLoadedWorkflowIds[channel]
              const idleHydration = createIdleHydrationState()
              idleHydration.workspaceId = newHydrationByChannel[channel]?.workspaceId ?? null
              newHydrationByChannel[channel] = idleHydration
            }
          })

          const wasDefaultActive = state.activeWorkflowIds[DEFAULT_WORKFLOW_CHANNEL_ID] === id

          if (wasDefaultActive) {
            clearedActiveWorkflow = true
          }

          return {
            workflows: newWorkflows,
            activeWorkflowIds: newActiveWorkflowIds,
            loadedWorkflowIds: newLoadedWorkflowIds,
            hydrationByChannel: newHydrationByChannel,
            isLoading: deriveIsMetadataLoading(newHydrationByChannel),
            error: null,
          }
        })

        if (clearedActiveWorkflow) {
          logger.info(
            `Cleared active workflow ${id} - user will need to manually select another workflow`
          )
        }

        logger.info(`Removed workflow ${id} from local state${skipApi ? ' (local only)' : ''}`)

        if (!skipApi) {
          // Cancel any schedule for this workflow (async, don't wait)
          fetch(API_ENDPOINTS.SCHEDULE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflowId: id,
              state: {
                blocks: {},
                edges: [],
                loops: {},
              },
            }),
          }).catch((error) => {
            logger.error(`Error cancelling schedule for deleted workflow ${id}:`, error)
          })
        }
      },

      // Update workflow metadata
      updateWorkflow: async (
        id: string,
        metadata: Partial<Pick<WorkflowMetadata, 'name' | 'description' | 'folderId'>>,
        source?: WorkflowMetadataSeed
      ) => {
        const { workflows } = get()
        const workflow = workflows[id] ?? source
        const workflowForState: WorkflowMetadata | null = workflow
          ? {
              ...workflow,
              lastModified: workflow.lastModified ?? new Date(),
              createdAt: workflow.createdAt ?? new Date(),
            }
          : null

        // Optimistically update local state first
        if (workflowForState) {
          set((state) => ({
            workflows: {
              ...state.workflows,
              [id]: {
                ...workflowForState,
                ...metadata,
                lastModified: new Date(),
                createdAt: workflowForState.createdAt,
              },
            },
            error: null,
          }))
        } else {
          set({ error: null })
        }

        // Persist to database via API
        try {
          const response = await fetch(`/api/workflows/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Failed to update workflow')
          }

          const { workflow: updatedWorkflow } = await response.json()
          logger.info(`Successfully updated workflow ${id} metadata`, metadata)

          // Update with server response to ensure consistency
          set((state) => ({
            workflows: {
              ...state.workflows,
              [id]: {
                ...(state.workflows[id] ?? workflowForState),
                id: updatedWorkflow.id ?? id,
                name: updatedWorkflow.name,
                description: updatedWorkflow.description,
                color: updatedWorkflow.color,
                workspaceId: updatedWorkflow.workspaceId,
                folderId: updatedWorkflow.folderId,
                lastModified: new Date(updatedWorkflow.updatedAt),
                createdAt: updatedWorkflow.createdAt
                  ? new Date(updatedWorkflow.createdAt)
                  : ((state.workflows[id] ?? workflowForState)?.createdAt ?? new Date()),
              },
            },
          }))
        } catch (error) {
          logger.error(`Failed to update workflow ${id} metadata:`, error)

          // Revert optimistic update on error
          set((state) => ({
            workflows: {
              ...state.workflows,
              ...(workflowForState ? { [id]: workflowForState } : {}),
            },
            error: `Failed to update workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
          }))
        }
      },

      logout: () => {
        logger.info('Logging out - clearing all workflow data')

        // Clear all state
        set({
          workflows: {},
          activeWorkflowIds: {},
          loadedWorkflowIds: {},
          hydrationByChannel: {},
          deploymentStatuses: {},
          isLoading: false,
          error: null,
        })

        logger.info('Logout complete - all workflow data cleared')
      },
    }),
    { name: 'workflow-registry' }
  )
)

// Keep registry channel map in sync with pair color contexts so linked widgets retain their workflow IDs.
syncRegistryFromPairContexts(usePairColorStore.getState().contexts)
usePairColorStore.subscribe((state) => syncRegistryFromPairContexts(state.contexts))
