'use client'

import { useEffect } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { getCopilotStore, useCopilotStore } from '@/stores/copilot/store'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useIndicatorsStore } from '@/stores/indicators/store'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/console/store'
import { useVariablesStore } from '@/stores/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useSubscriptionStore } from '@/stores/subscription/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('Stores')

// Track initialization state
let isInitializing = false
let appFullyInitialized = false
let dataInitialized = false // Flag for actual data loading completion

const AUTH_COOKIE_KEYS = [
  'better-auth.session_token',
  'better-auth.session_data',
  'better-auth.dont_remember',
  '__Secure-better-auth.session_token',
  '__Secure-better-auth.session_data',
  '__Secure-better-auth.dont_remember',
]

function hasAuthCookie(): boolean {
  if (typeof document === 'undefined') return false
  return AUTH_COOKIE_KEYS.some((key) => document.cookie.includes(`${key}=`))
}

/**
 * Initialize the application state and sync system
 * localStorage persistence has been removed - relies on DB and Zustand stores only
 */
async function initializeApplication(): Promise<void> {
  if (typeof window === 'undefined' || isInitializing) return

  // Skip initialization entirely when no auth cookie is present to avoid
  // unauthenticated 401 loops while the app is redirecting to /login.
  if (!hasAuthCookie()) {
    logger.info('Auth cookie missing, skipping app initialization')
    appFullyInitialized = false
    dataInitialized = false
    return
  }

  isInitializing = true
  appFullyInitialized = false

  // Track initialization start time
  const initStartTime = Date.now()

  try {
    // Load environment variables directly from DB
    await useEnvironmentStore.getState().loadEnvironmentVariables()

    // Mark data as initialized only after sync managers have loaded data from DB
    dataInitialized = true

    // Log initialization timing information
    const initDuration = Date.now() - initStartTime
    logger.info(`Application initialization completed in ${initDuration}ms`)

    // Mark application as fully initialized
    appFullyInitialized = true
  } catch (error) {
    logger.error('Error during application initialization:', { error })
    // Still mark as initialized to prevent being stuck in initializing state
    appFullyInitialized = true
    // But don't mark data as initialized on error
    dataInitialized = false
  } finally {
    isInitializing = false
  }
}

/**
 * Checks if application is fully initialized
 */
export function isAppInitialized(): boolean {
  return appFullyInitialized
}

/**
 * Checks if data has been loaded from the database
 * This should be checked before any sync operations
 */
export function isDataInitialized(): boolean {
  return dataInitialized
}

/**
 * Handle application cleanup before unload
 */
function handleBeforeUnload(event: BeforeUnloadEvent): void {
  // Check if we're on an authentication page and skip confirmation if we are
  if (typeof window !== 'undefined') {
    const path = window.location.pathname
    // Skip confirmation for auth-related pages
    if (
      path === '/login' ||
      path === '/signup' ||
      path === '/reset-password' ||
      path === '/verify'
    ) {
      return
    }
  }

  // Standard beforeunload pattern
  event.preventDefault()
  event.returnValue = ''
}

/**
 * Clean up sync system
 */
function cleanupApplication(): void {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  // Note: No sync managers to dispose - Socket.IO handles cleanup
}

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

    // Clear localStorage except for essential app settings (minimal usage)
    const keysToKeep = ['next-favicon', 'theme']
    const keysToRemove = Object.keys(localStorage).filter((key) => !keysToKeep.includes(key))
    keysToRemove.forEach((key) => localStorage.removeItem(key))

    // Reset application initialization state
    appFullyInitialized = false
    dataInitialized = false

    logger.info('User data cleared successfully')
  } catch (error) {
    logger.error('Error clearing user data:', { error })
  }
}

/**
 * Hook to manage application lifecycle
 */
export function useAppInitialization() {
  useEffect(() => {
    // Use Promise to handle async initialization
    initializeApplication()

    return () => {
      cleanupApplication()
    }
  }, [])
}

/**
 * Hook to reinitialize the application after successful login
 * Use this in the login success handler or post-login page
 */
export function useLoginInitialization() {
  useEffect(() => {
    reinitializeAfterLogin()
  }, [])
}

/**
 * Reinitialize the application after login
 * This ensures we load fresh data from the database for the new user
 */
export async function reinitializeAfterLogin(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Reset application initialization state
    appFullyInitialized = false
    dataInitialized = false

    // Note: No sync managers to dispose - Socket.IO handles cleanup

    // Clean existing state to avoid stale data
    resetAllStores()

    // Reset initialization flags to force a fresh load
    isInitializing = false

    // Reinitialize the application
    await initializeApplication()

    logger.info('Application reinitialized after login')
  } catch (error) {
    logger.error('Error reinitializing application:', { error })
  }
}

// Initialize immediately when imported on client
if (typeof window !== 'undefined') {
  initializeApplication()
}

// Export all stores
export {
  useWorkflowStore,
  useWorkflowRegistry,
  useEnvironmentStore,
  useExecutionStore,
  useConsoleStore,
  useCopilotStore,
  useCustomToolsStore,
  useIndicatorsStore,
  useVariablesStore,
  useSubBlockStore,
  useSubscriptionStore,
}

// Helper function to reset all stores
export const resetAllStores = () => {
  // Reset all stores to initial state
  useWorkflowRegistry.setState({
    workflows: {},
    activeWorkflowIds: {},
    loadedWorkflowIds: {},
    isLoading: false,
    error: null,
  })
  useWorkflowStore.getState().clear()
  useSubBlockStore.getState().clear()
  useEnvironmentStore.setState({
    variables: {},
    isLoading: false,
    error: null,
  })
  useExecutionStore.getState().reset()
  useConsoleStore.setState({ entries: [], isOpen: false })
  getCopilotStore().setState({ messages: [], isSendingMessage: false, error: null })
  useCustomToolsStore.getState().resetAll()
  useIndicatorsStore.getState().resetAll()
  // Variables store has no tracking to reset; registry hydrates
  useSubscriptionStore.getState().reset() // Reset subscription store
}

// Helper function to log all store states
export const logAllStores = () => {
  const state = {
    workflow: useWorkflowStore.getState(),
    workflowRegistry: useWorkflowRegistry.getState(),
    environment: useEnvironmentStore.getState(),
    execution: useExecutionStore.getState(),
    console: useConsoleStore.getState(),
    copilot: getCopilotStore().getState(),
    customTools: useCustomToolsStore.getState(),
    indicators: useIndicatorsStore.getState(),
    subBlock: useSubBlockStore.getState(),
    variables: useVariablesStore.getState(),
    subscription: useSubscriptionStore.getState(),
  }

  return state
}
