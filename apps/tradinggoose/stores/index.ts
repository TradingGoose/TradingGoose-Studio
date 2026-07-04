'use client'

import { createLogger } from '@/lib/logs/console/logger'
import { getQueryClient } from '@/app/query-provider'
import { resetWorkspacePermissionsStore } from '@/hooks/use-workspace-permissions'
import { useConsoleStore } from '@/stores/console/store'
import { getCopilotStore, useCopilotStore } from '@/stores/copilot/store'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('Stores')

/**
 * Clear all user data when signing out
 * localStorage persistence has been removed
 */
export async function clearUserData(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Note: No sync managers to dispose - Socket.IO handles cleanup

    // Reset all stores to their initial state
    resetAllStores()
    getQueryClient().clear()

    // Clear localStorage except for essential app settings (minimal usage)
    const keysToKeep = ['next-favicon', 'theme']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))

    logger.info('User data cleared successfully')
  } catch (error) {
    logger.error('Error clearing user data:', { error })
  }
}

// Export all stores
export {
  useWorkflowRegistry,
  useEnvironmentStore,
  useExecutionStore,
  useConsoleStore,
  useCopilotStore,
  useCustomToolsStore,
  useIndicatorsStore,
  useSubscriptionStore,
}

// Helper function to reset all stores
export const resetAllStores = () => {
  // Reset all stores to initial state
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowIds: {},
    loadedWorkflowIds: {},
    hydrationByChannel: {},
    deploymentStatuses: {},
    isLoading: false,
    error: null,
  })
  useEnvironmentStore.setState({
    variables: {},
    isLoading: false,
    error: null,
  })
  useExecutionStore.getState().reset()
  useConsoleStore.setState({ entries: [] })
  getCopilotStore().setState({ messages: [], isSendingMessage: false })
  useCustomToolsStore.getState().resetAll()
  useIndicatorsStore.getState().resetAll()
  resetWorkspacePermissionsStore()
  // Variables store has no tracking to reset; registry hydrates
  useSubscriptionStore.getState().reset() // Reset subscription store
}

// Helper function to log all store states
export const logAllStores = () => {
  const state = {
    workflowRegistry: useWorkflowRegistry.getState(),
    environment: useEnvironmentStore.getState(),
    execution: useExecutionStore.getState(),
    console: useConsoleStore.getState(),
    copilot: getCopilotStore().getState(),
    customTools: useCustomToolsStore.getState(),
    indicators: useIndicatorsStore.getState(),
    subscription: useSubscriptionStore.getState(),
  }

  return state
}
