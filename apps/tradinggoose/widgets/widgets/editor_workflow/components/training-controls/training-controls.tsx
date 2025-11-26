'use client'

import { useCallback, useEffect, useState } from 'react'
import { getEnv, isTruthy } from '@/lib/env'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { EMPTY_CHANNEL_TRAINING_STATE, useCopilotTrainingStore } from '@/stores/copilot-training/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'
import { TrainingFloatingButton } from './training-floating-button'
import { TrainingModal } from './training-modal'

/**
 * Main training controls component that manages the training UI
 * Only renders if COPILOT_TRAINING_ENABLED env var is set AND user has enabled it in settings
 */
interface TrainingControlsProps {
  /**
   * Forces controls to render regardless of the user's settings toggle.
   * Still requires the env flag so we don't leak the feature when completely disabled.
   */
  forceVisible?: boolean
  channelId?: string
  constrainToContainer?: boolean
}

export function TrainingControls({
  forceVisible = false,
  channelId: channelIdProp,
  constrainToContainer = false,
}: TrainingControlsProps = {}) {
  const [isEnvEnabled, setIsEnvEnabled] = useState(false)
  const showTrainingControls = useGeneralStore((state) => state.showTrainingControls)
  const workflowRoute = useOptionalWorkflowRoute()
  const resolvedChannelId = channelIdProp ?? workflowRoute?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID
  const channelState = useCopilotTrainingStore(
    useCallback(
      (state) =>
        state?.channels?.[resolvedChannelId] ??
        state?.channels?.[DEFAULT_WORKFLOW_CHANNEL_ID] ??
        EMPTY_CHANNEL_TRAINING_STATE,
      [resolvedChannelId]
    )
  )
  const isTraining = channelState.isTraining
  const ensureChannel = useCopilotTrainingStore((state) => state?.ensureChannel ?? (() => undefined))
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Check environment variable on mount
  useEffect(() => {
    // Use getEnv to check if training is enabled
    const trainingEnabled = isTruthy(getEnv('NEXT_PUBLIC_COPILOT_TRAINING_ENABLED'))
    setIsEnvEnabled(trainingEnabled)
  }, [])

  useEffect(() => {
    ensureChannel(resolvedChannelId)
  }, [ensureChannel, resolvedChannelId])

  const handleToggleModal = useCallback(() => {
    ensureChannel(resolvedChannelId)
    setIsModalOpen(true)
  }, [ensureChannel, resolvedChannelId])

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false)
  }, [])

  // Don't render if not enabled by env var OR user settings
  if (!isEnvEnabled || (!forceVisible && !showTrainingControls)) {
    return null
  }

  return (
    <>
      {/* Floating button to start/stop training */}
      <TrainingFloatingButton
        channelId={resolvedChannelId}
        isTraining={isTraining}
        onToggleModal={handleToggleModal}
        constrainToContainer={constrainToContainer}
      />

      {/* Modal for entering prompt and viewing dataset */}
      {isModalOpen && (
        <TrainingModal
          channelId={resolvedChannelId}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
        />
      )}
    </>
  )
}
