'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bug,
  LayoutDashboard,
  Play,
  RefreshCw,
  SkipForward,
  StepForward,
  Store,
  X,
} from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  getKeyboardShortcutText,
  useKeyboardShortcuts,
} from '@/app/workspace/[workspaceId]/components/use-keyboard-shortcuts'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks'
import { useWorkflowExecution } from '@/hooks/workflow/use-workflow-execution'

import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowBlocks, useWorkflowEdges } from '@/lib/yjs/use-workflow-doc'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import {
  DeploymentControls,
  ExportControls,
  TemplateModal,
} from '@/widgets/widgets/editor_workflow/components/control-bar/components'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ControlBar')

// Cache for usage data to prevent excessive API calls
let usageDataCache: {
  data: any | null
  timestamp: number
  expirationMs: number
} = {
  data: null,
  timestamp: 0,
  // Cache expires after 1 minute
  expirationMs: 60 * 1000,
}

interface ControlBarProps {
  hasValidationErrors?: boolean
  hasLockedBlocks?: boolean
  className?: string
  variant?: 'widget'
}

const WIDGET_ICON_BUTTON_CLASS = widgetHeaderIconButtonClassName()
const WIDGET_ICON_BUTTON_DISABLED_CLASS = cn(
  widgetHeaderIconButtonClassName(),
  'cursor-not-allowed opacity-60'
)

const WIDGET_PRIMARY_BUTTON_CLASS = cn(
  widgetHeaderIconButtonClassName(),
  'bg-primary hover:bg-primary-hover hover:text-black text-black '
)

const WIDGET_DANGER_BUTTON_CLASS = cn(
  widgetHeaderIconButtonClassName(),
  'bg-red-500 text-white hover:bg-red-600'
)

const getIconButtonClass = (extra?: string) => cn(WIDGET_ICON_BUTTON_CLASS, extra)

const getDisabledIconButtonClass = (extra?: string) => cn(WIDGET_ICON_BUTTON_DISABLED_CLASS, extra)

const getPrimaryButtonClass = (extra?: string) => cn(WIDGET_PRIMARY_BUTTON_CLASS, extra)

const getDangerButtonClass = (extra?: string) => cn(WIDGET_DANGER_BUTTON_CLASS, extra)

/**
 * Control bar for managing workflows - handles editing, deployment,
 * history, notifications and execution.
 */
export function ControlBar({
  hasValidationErrors = false,
  hasLockedBlocks = false,
  className,
  variant = 'widget',
}: ControlBarProps) {
  const { data: session } = useSession()
  const { workflowId, channelId } = useWorkflowRoute()
  // Store hooks
  const blocks = useWorkflowBlocks()
  const isRegistryLoading = useWorkflowRegistry((state) => state.isLoading)
  const activeWorkflowId = workflowId
  const { isExecuting, handleRunWorkflow, handleCancelExecution } = useWorkflowExecution()

  // User permissions - use stable activeWorkspaceId from registry instead of deriving from currentWorkflow
  const userPermissions = useUserPermissionsContext()

  // Debug mode state
  const { isDebugging, pendingBlocks, handleStepDebug, handleCancelDebug, handleResumeDebug } =
    useWorkflowExecution()

  // Local state
  const [, forceUpdate] = useState({})
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
  const [isAutoLayouting, setIsAutoLayouting] = useState(false)

  // Deployed state management
  const [deployedState, setDeployedState] = useState<WorkflowState | null>(null)
  const [isLoadingDeployedState, setIsLoadingDeployedState] = useState<boolean>(false)

  // Change detection state
  const [changeDetected, setChangeDetected] = useState(false)

  // Usage limit state
  const [usageExceeded, setUsageExceeded] = useState(false)
  const [usageData, setUsageData] = useState<{
    percentUsed: number
    isWarning: boolean
    isExceeded: boolean
    currentUsage: number
    limit: number
  } | null>(null)

  // Shared condition for keyboard shortcut and button disabled state
  const isWorkflowBlocked = isExecuting || hasValidationErrors

  // Register keyboard shortcut for running workflow
  useKeyboardShortcuts(() => {
    if (!isWorkflowBlocked) {
      handleRunWorkflow()
    }
  }, isWorkflowBlocked)

  // // Check if the current user is the owner of the published workflow
  // const isWorkflowOwner = () => {
  //   const marketplaceData = getMarketplaceData()
  //   return marketplaceData?.status === 'owner'
  // }

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.getWorkflowDeploymentStatus(activeWorkflowId)
  )
  const isDeployed = deploymentStatus?.isDeployed || false

  // Update the time display every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 60000)
    return () => clearInterval(interval)
  }, [])

  /**
   * Fetches the deployed state of the workflow from the server
   * This is the single source of truth for deployed workflow state
   */
  const fetchDeployedState = async () => {
    if (!activeWorkflowId || !isDeployed) {
      setDeployedState(null)
      return
    }

    // Store the workflow ID at the start of the request to prevent race conditions
    const requestWorkflowId = activeWorkflowId

    // Helper to get current active workflow ID for race condition checks
    const getCurrentActiveWorkflowId = () =>
      useWorkflowRegistry.getState().getActiveWorkflowId(channelId)

    try {
      setIsLoadingDeployedState(true)

      const response = await fetch(`/api/workflows/${requestWorkflowId}/deployed`)

      // Check if the workflow ID changed during the request (user navigated away)
      if (requestWorkflowId !== getCurrentActiveWorkflowId()) {
        logger.debug('Workflow changed during deployed state fetch, ignoring response')
        return
      }

      if (!response.ok) {
        if (response.status === 404) {
          setDeployedState(null)
          return
        }
        throw new Error(`Failed to fetch deployed state: ${response.statusText}`)
      }

      const data = await response.json()

      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setDeployedState(data.deployedState || null)
      } else {
        logger.debug('Workflow changed after deployed state response, ignoring result')
      }
    } catch (error) {
      logger.error('Error fetching deployed state:', { error })
      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setDeployedState(null)
      }
    } finally {
      if (requestWorkflowId === getCurrentActiveWorkflowId()) {
        setIsLoadingDeployedState(false)
      }
    }
  }

  useEffect(() => {
    if (!activeWorkflowId) {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
      return
    }

    if (isRegistryLoading) {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
      return
    }

    if (isDeployed) {
      fetchDeployedState()
    } else {
      setDeployedState(null)
      setIsLoadingDeployedState(false)
    }
  }, [activeWorkflowId, isDeployed, isRegistryLoading])

  // Get current state for change detection (from Yjs doc)
  const currentBlocks = useWorkflowBlocks()
  const currentEdges = useWorkflowEdges()

  useEffect(() => {
    if (!activeWorkflowId || !deployedState) {
      setChangeDetected(false)
      return
    }

    if (isLoadingDeployedState) {
      return
    }

    // Check if the live workflow state differs from the deployed state
    const checkForChanges = async () => {
      try {
        const response = await fetch(`/api/workflows/${activeWorkflowId}/status`)
        if (response.ok) {
          const data = await response.json()
          setChangeDetected(data.needsRedeployment || false)
        } else {
          logger.error('Failed to fetch workflow status:', response.status, response.statusText)
          setChangeDetected(false)
        }
      } catch (error) {
        logger.error('Error fetching workflow status:', error)
        setChangeDetected(false)
      }
    }

    checkForChanges()
  }, [
    activeWorkflowId,
    deployedState,
    currentBlocks,
    currentEdges,
    isLoadingDeployedState,
  ])

  useEffect(() => {
    if (session?.user?.id && !isRegistryLoading) {
      checkUserUsage().then((usage) => {
        if (usage) {
          setUsageExceeded(usage.isExceeded)
          setUsageData(usage)
        }
      })
    }
  }, [session?.user?.id, isRegistryLoading])

  /**
   * Check user usage limits and cache results
   */
  async function checkUserUsage(forceRefresh = false): Promise<any | null> {
    const now = Date.now()
    const cacheAge = now - usageDataCache.timestamp

    // Return cached data if still valid and not forcing refresh
    if (!forceRefresh && usageDataCache.data && cacheAge < usageDataCache.expirationMs) {
      logger.info('Using cached usage data', {
        cacheAge: `${Math.round(cacheAge / 1000)}s`,
      })
      return usageDataCache.data
    }

    try {
      // Primary: call server-side usage check to mirror backend enforcement
      const res = await fetch('/api/usage?context=user', { cache: 'no-store' })
      if (res.ok) {
        const payload = await res.json()
        const usage = payload?.data
        // Update cache
        usageDataCache = { data: usage, timestamp: now, expirationMs: usageDataCache.expirationMs }
        return usage
      }

      return null
    } catch (error) {
      logger.error('Error checking usage limits:', { error })
      return null
    }
  }

  // Helper function to open subscription settings
  const openSubscriptionSettings = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('open-settings', {
          detail: { tab: 'subscription' },
        })
      )
    }
  }

  /**
   * Render deploy button with tooltip
   */
  const renderDeployButton = () => (
    <DeploymentControls
      activeWorkflowId={activeWorkflowId}
      needsRedeployment={changeDetected}
      setNeedsRedeployment={setChangeDetected}
      deployedState={deployedState}
      isLoadingDeployedState={isLoadingDeployedState}
      refetchDeployedState={fetchDeployedState}
      userPermissions={userPermissions}
      variant={variant}
    />
  )

  /**
   * Render auto-layout button
   */
  const renderAutoLayoutButton = () => {
    const handleAutoLayoutClick = async () => {
      if (isExecuting || isDebugging || !userPermissions.canEdit || isAutoLayouting || hasLockedBlocks) {
        return
      }

      setIsAutoLayouting(true)
      try {
        // Use the shared auto layout utility for immediate frontend updates
        const { applyAutoLayoutAndUpdateStore } = await import(
          '@/widgets/widgets/editor_workflow/components/control-bar/auto-layout'
        )

        const result = await applyAutoLayoutAndUpdateStore({
          workflowId: activeWorkflowId!,
          channelId,
          undoUserId: session?.user?.id,
        })

        if (result.success) {
          logger.info('Auto layout completed successfully')
        } else {
          logger.error('Auto layout failed:', result.error)
          // You could add a toast notification here if available
        }
      } catch (error) {
        logger.error('Auto layout error:', error)
        // You could add a toast notification here if available
      } finally {
        setIsAutoLayouting(false)
      }
    }

    const canEdit = userPermissions.canEdit
    const isDisabled = isExecuting || isDebugging || !canEdit || isAutoLayouting || hasLockedBlocks

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to use auto-layout'
      if (hasLockedBlocks) return 'Auto-layout is disabled when blocks are locked'
      if (isDebugging) return 'Cannot auto-layout while debugging'
      if (isExecuting) return 'Cannot auto-layout while workflow is running'
      if (isAutoLayouting) return 'Applying auto-layout...'
      return 'Auto layout'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className={getDisabledIconButtonClass()}>
              {isAutoLayouting ? (
                <RefreshCw className='h-4 w-4 animate-spin' />
              ) : (
                <LayoutDashboard className='h-4 w-4' />
              )}
            </div>
          ) : (
            <Button
              variant='outline'
              onClick={handleAutoLayoutClick}
              className={getIconButtonClass()}
              disabled={isAutoLayouting}
            >
              {isAutoLayouting ? (
                <RefreshCw className='h-5 w-5 animate-spin' />
              ) : (
                <LayoutDashboard className='h-5 w-5' />
              )}
              <span className='sr-only'>Auto Layout</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent command={`${isDebugging ? '' : 'Shift+L'}`}>
          {getTooltipText()}
        </TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Handles debug mode toggle - starts or stops debugging
   */
  const handleDebugToggle = useCallback(() => {
    if (!userPermissions.canRead) return

    if (isDebugging) {
      // Stop debugging
      handleCancelDebug()
    } else {
      // Check if there are executable blocks before starting debug mode
      const hasExecutableBlocks = Object.values(blocks).some((block) => {
        const blockConfig = getBlock(block.type)
        return block.enabled !== false && blockConfig?.category !== 'triggers'
      })

      if (!hasExecutableBlocks) {
        return // Do nothing if no executable blocks
      }

      // Start debugging
      if (usageExceeded) {
        openSubscriptionSettings()
      } else {
        handleRunWorkflow(undefined, true) // Start in debug mode
      }
    }
  }, [
    userPermissions.canRead,
    isDebugging,
    usageExceeded,
    blocks,
    handleCancelDebug,
    handleRunWorkflow,
  ])

  /**
   * Render debug controls bar (replaces run button when debugging)
   */
  const renderDebugControlsBar = () => {
    const pendingCount = pendingBlocks.length
    const isControlDisabled = pendingCount === 0

    const debugButtonClass = cn(
      getIconButtonClass('bg-primary  hover:bg-primary-hover'),
      'font-semibold transition-all duration-200',
      'disabled:opacity-50'
    )

    return (
      <div className='flex items-center gap-1'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                handleStepDebug()
              }}
              className={debugButtonClass}
              disabled={isControlDisabled}
            >
              <StepForward className='h-5 w-5' />
              <span className='sr-only'>Step Forward</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Step Forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                handleResumeDebug()
              }}
              className={debugButtonClass}
              disabled={isControlDisabled}
            >
              <SkipForward className='h-5 w-5' />
              <span className='sr-only'>Resume Until End</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resume Until End</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => {
                handleCancelDebug()
              }}
              className={debugButtonClass}
            >
              <X className='h-5 w-5' />
              <span className='sr-only'>Cancel Debugging</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel Debugging</TooltipContent>
        </Tooltip>
      </div>
    )
  }

  /**
   * Render publish template button
   */
  const renderPublishButton = () => {
    const canEdit = userPermissions.canEdit
    const isDisabled = isExecuting || isDebugging || !canEdit

    const getTooltipText = () => {
      if (!canEdit) return 'Admin permission required to publish templates'
      if (isDebugging) return 'Cannot publish template while debugging'
      if (isExecuting) return 'Cannot publish template while workflow is running'
      return 'Publish as template'
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className={getDisabledIconButtonClass()}>
              <Store className='h-4 w-4' />
            </div>
          ) : (
            <Button
              variant='outline'
              onClick={() => setIsTemplateModalOpen(true)}
              className={getIconButtonClass()}
            >
              <Store className='h-5 w-5' />
              <span className='sr-only'>Publish Template</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render debug mode toggle button
   */
  const renderDebugModeToggle = () => {
    const canDebug = userPermissions.canRead

    // Check if there are any meaningful blocks in the workflow (excluding triggers)
    const hasExecutableBlocks = Object.values(blocks).some((block) => {
      const blockConfig = getBlock(block.type)
      return block.enabled !== false && blockConfig?.category !== 'triggers'
    })

    const isDisabled = isExecuting || !canDebug || !hasExecutableBlocks

    const getTooltipText = () => {
      if (!canDebug) return 'Read permission required to use debug mode'
      if (!hasExecutableBlocks) return 'Add blocks to enable debug mode'
      return isDebugging ? 'Stop debugging' : 'Start debugging'
    }

    const buttonClass = cn(getIconButtonClass(), isDebugging && 'text-yellow-500')

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {isDisabled ? (
            <div className={cn(getDisabledIconButtonClass(), isDebugging && 'text-yellow-500')}>
              <Bug className='h-4 w-4' />
            </div>
          ) : (
            <Button variant='outline' onClick={handleDebugToggle} className={buttonClass}>
              <Bug className='h-5 w-5' />
              <span className='sr-only'>{getTooltipText()}</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render run workflow button or cancel button when executing
   */
  const renderRunButton = () => {
    const canRun = userPermissions.canRead // Running only requires read permissions
    const isLoadingPermissions = userPermissions.isLoading
    const isButtonDisabled =
      !isExecuting && (isWorkflowBlocked || (!canRun && !isLoadingPermissions))

    // If currently executing, show cancel button
    if (isExecuting) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className={getDangerButtonClass()} onClick={handleCancelExecution}>
              <X className={cn('h-3.5 w-3.5')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel execution</TooltipContent>
        </Tooltip>
      )
    }

    const getTooltipContent = () => {
      if (hasValidationErrors) {
        return (
          <div className='text-center'>
            <p className='font-medium text-destructive'>Workflow Has Errors</p>
            <p className='text-xs'>
              Nested subflows are not supported. Remove subflow blocks from inside other subflow
              blocks.
            </p>
          </div>
        )
      }

      if (!canRun && !isLoadingPermissions) {
        return 'Read permission required to run workflows'
      }

      if (usageExceeded) {
        return (
          <div className='text-center'>
            <p className='font-medium text-destructive'>Usage Limit Exceeded</p>
            <p className='text-xs'>
              You've used {usageData?.currentUsage?.toFixed(2) || 0}$ of{' '}
              {usageData?.limit?.toFixed(2) || 0}$ Upgrade your plan to continue.
            </p>
          </div>
        )
      }

      return 'Run'
    }

    const handleRunClick = () => {
      if (usageExceeded) {
        openSubscriptionSettings()
      } else {
        handleRunWorkflow()
      }
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={getPrimaryButtonClass()}
            onClick={handleRunClick}
            disabled={isButtonDisabled}
          >
            <Play className={cn('h-3.5 w-3.5', 'fill-current stroke-current')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent command={getKeyboardShortcutText('Enter', true)}>
          {getTooltipContent()}
        </TooltipContent>
      </Tooltip>
    )
  }

  const showOptionalControls = true
  const defaultContainerClass = 'inline-flex flex-nowrap'
  const containerClass = widgetHeaderButtonGroupClassName(className ?? defaultContainerClass)

  return (
    <div className={containerClass}>
      {showOptionalControls && <ExportControls variant={variant} />}
      {showOptionalControls && renderAutoLayoutButton()}
      {showOptionalControls && renderPublishButton()}
      {!isDebugging && renderDebugModeToggle()}
      {renderDeployButton()}
      {isDebugging ? renderDebugControlsBar() : renderRunButton()}

      {/* Template Modal */}
      {activeWorkflowId && (
        <TemplateModal
          open={isTemplateModalOpen}
          onOpenChange={setIsTemplateModalOpen}
          workflowId={activeWorkflowId}
        />
      )}
    </div>
  )
}
