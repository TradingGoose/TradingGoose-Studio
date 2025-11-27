import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
import {
  computeEditSequence,
  type EditOperation,
} from '@/lib/workflows/training/compute-edit-sequence'
import { DEFAULT_WORKFLOW_CHANNEL_ID, useWorkflowStore } from '@/stores/workflows/workflow/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotTrainingStore')

export interface TrainingDataset {
  id: string
  workflowId: string
  title: string
  prompt: string
  startState: WorkflowState
  endState: WorkflowState
  editSequence: EditOperation[]
  createdAt: Date
  sentAt?: Date
  metadata?: {
    duration?: number // Time taken to complete edits in ms
    blockCount?: number
    edgeCount?: number
  }
}

export interface ChannelTrainingState {
  isTraining: boolean
  currentTitle: string
  currentPrompt: string
  startSnapshot: WorkflowState | null
  startTime: number | null
  datasets: TrainingDataset[]
}

const baseChannelState: Omit<ChannelTrainingState, 'datasets'> = {
  isTraining: false,
  currentTitle: '',
  currentPrompt: '',
  startSnapshot: null,
  startTime: null,
}

const createChannelState = (): ChannelTrainingState => ({
  ...baseChannelState,
  datasets: [],
})

export const EMPTY_CHANNEL_TRAINING_STATE: ChannelTrainingState = {
  ...baseChannelState,
  datasets: [],
}

const resolveChannelKey = (channelId?: string) =>
  channelId && channelId.trim().length > 0 ? channelId : DEFAULT_WORKFLOW_CHANNEL_ID

const getChannelMap = (
  state?: CopilotTrainingState
): { channels: Record<string, ChannelTrainingState>; hasExistingState: boolean } => {
  if (state?.channels && Object.keys(state.channels).length > 0) {
    return { channels: state.channels, hasExistingState: true }
  }

  return {
    channels: {
      [DEFAULT_WORKFLOW_CHANNEL_ID]: createChannelState(),
    },
    hasExistingState: false,
  }
}

const updateChannelState = (
  state: CopilotTrainingState | undefined,
  channelKey: string,
  updater: (channel: ChannelTrainingState) => ChannelTrainingState
) => {
  const { channels } = getChannelMap(state)
  return {
    channels: {
      ...channels,
      [channelKey]: updater(channels[channelKey] ?? createChannelState()),
    },
  }
}

/**
 * Get a clean snapshot of the current workflow state
 */
function captureWorkflowSnapshot(channelId?: string): WorkflowState {
  const rawState = useWorkflowStore.getState(channelId).getWorkflowState()

  // Merge subblock values to get complete state
  const blocksWithSubblockValues = mergeSubblockState(rawState.blocks)

  // Clean the state - only include essential fields
  return {
    blocks: blocksWithSubblockValues,
    edges: rawState.edges || [],
    loops: rawState.loops || {},
    parallels: rawState.parallels || {},
    lastSaved: Date.now(),
  }
}

interface CopilotTrainingState {
  channels: Record<string, ChannelTrainingState>
  ensureChannel: (channelId?: string) => void
  startTraining: (channelId: string | undefined, title: string, prompt: string) => void
  stopTraining: (channelId?: string) => TrainingDataset | null
  cancelTraining: (channelId?: string) => void
  setPrompt: (channelId: string | undefined, prompt: string) => void
  clearDatasets: (channelId?: string) => void
  exportDatasets: (channelId?: string) => string
  markDatasetSent: (channelId: string | undefined, id: string, sentAt?: Date) => void
}

export const useCopilotTrainingStore = create<CopilotTrainingState>()(
  devtools(
    (set, get) => ({
      channels: {
        [DEFAULT_WORKFLOW_CHANNEL_ID]: createChannelState(),
      },

      ensureChannel: (channelId) => {
        const key = resolveChannelKey(channelId)
        set((state) => {
          const { channels, hasExistingState } = getChannelMap(state)
          if (channels[key] && hasExistingState) {
            return undefined
          }
          return {
            channels: {
              ...channels,
              [key]: createChannelState(),
            },
          }
        })
      },

      // Start a new training session
      startTraining: (channelId, title, prompt) => {
        if (!prompt.trim()) {
          logger.warn('Cannot start training without a prompt')
          return
        }
        if (!title.trim()) {
          logger.warn('Cannot start training without a title')
          return
        }

        const key = resolveChannelKey(channelId)
        const snapshot = captureWorkflowSnapshot(channelId)

        logger.info('Starting training session', {
          title,
          prompt,
          channelId: key,
          blockCount: Object.keys(snapshot.blocks).length,
          edgeCount: snapshot.edges.length,
        })

        set((state) =>
          updateChannelState(state, key, (channel) => ({
            ...channel,
            isTraining: true,
            currentTitle: title,
            currentPrompt: prompt,
            startSnapshot: snapshot,
            startTime: Date.now(),
          }))
        )
      },

      // Stop training and save the dataset
      stopTraining: (channelId) => {
        const key = resolveChannelKey(channelId)
        const channelState = get().channels[key]

        if (!channelState || !channelState.isTraining || !channelState.startSnapshot) {
          logger.warn('No active training session to stop', { channelId: key })
          return null
        }

        const endSnapshot = captureWorkflowSnapshot(channelId)
        const duration = channelState.startTime ? Date.now() - channelState.startTime : 0

        // Sanitize snapshots for compute-edit-sequence (it works with sanitized state)
        const sanitizedStart = sanitizeForCopilot(channelState.startSnapshot)
        const sanitizedEnd = sanitizeForCopilot(endSnapshot)

        // Compute the edit sequence
        const { operations, summary } = computeEditSequence(sanitizedStart, sanitizedEnd)

        // Get workflow ID from the store
        const { activeWorkflowId } = useWorkflowStore.getState(channelId) as any

        const dataset: TrainingDataset = {
          id: crypto.randomUUID(),
          workflowId: activeWorkflowId || 'unknown',
          title: channelState.currentTitle,
          prompt: channelState.currentPrompt,
          startState: channelState.startSnapshot,
          endState: endSnapshot,
          editSequence: operations,
          createdAt: new Date(),
          metadata: {
            duration,
            blockCount: Object.keys(endSnapshot.blocks).length,
            edgeCount: endSnapshot.edges.length,
          },
        }

        logger.info('Training session completed', {
          title: channelState.currentTitle,
          prompt: channelState.currentPrompt,
          channelId: key,
          duration,
          operations: operations.length,
          summary,
        })

        set((state) =>
          updateChannelState(state, key, (channel) => ({
            ...channel,
            isTraining: false,
            currentTitle: '',
            currentPrompt: '',
            startSnapshot: null,
            startTime: null,
            datasets: [...channel.datasets, dataset],
          }))
        )

        return dataset
      },

      // Cancel training without saving
      cancelTraining: (channelId) => {
        const key = resolveChannelKey(channelId)
        logger.info('Training session cancelled', { channelId: key })

        set((state) =>
          updateChannelState(state, key, (channel) => ({
            ...channel,
            isTraining: false,
            currentTitle: '',
            currentPrompt: '',
            startSnapshot: null,
            startTime: null,
          }))
        )
      },

      // Update the prompt
      setPrompt: (channelId, prompt) => {
        const key = resolveChannelKey(channelId)
        set((state) =>
          updateChannelState(state, key, (channel) => ({
            ...channel,
            currentPrompt: prompt,
          }))
        )
      },

      // Clear all datasets
      clearDatasets: (channelId) => {
        const key = resolveChannelKey(channelId)
        logger.info('Clearing all training datasets', { channelId: key })
        set((state) =>
          updateChannelState(state, key, (channel) => ({
            ...channel,
            datasets: [],
          }))
        )
      },

      // Export datasets as JSON
      exportDatasets: (channelId) => {
        const key = resolveChannelKey(channelId)
        const datasets = get().channels[key]?.datasets ?? []

        const exportData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          datasets: datasets.map((d) => ({
            id: d.id,
            workflowId: d.workflowId,
            prompt: d.prompt,
            startState: d.startState,
            endState: d.endState,
            editSequence: d.editSequence,
            createdAt: d.createdAt.toISOString(),
            sentAt: d.sentAt ? d.sentAt.toISOString() : undefined,
            metadata: d.metadata,
          })),
        }

        return JSON.stringify(exportData, null, 2)
      },

      // Mark a dataset as sent (persist a timestamp)
      markDatasetSent: (channelId, id, sentAt) => {
        const key = resolveChannelKey(channelId)
        const when = sentAt ?? new Date()
        set((state) =>
          updateChannelState(state, key, (channel) => ({
            ...channel,
            datasets: channel.datasets.map((d) =>
              d.id === id
                ? {
                    ...d,
                    sentAt: when,
                  }
                : d
            ),
          }))
        )
      },
    }),
    {
      name: 'copilot-training-store',
    }
  )
)
