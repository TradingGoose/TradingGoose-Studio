'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, LayoutDashboard, Play, RefreshCw, X } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { listWorkflowRunTriggers } from '@/lib/workflows/triggers'
import { useWorkflowBlocks, useWorkflowEdges } from '@/lib/yjs/use-workflow-doc'
import {
  getKeyboardShortcutText,
  useKeyboardShortcuts,
} from '@/app/workspace/[workspaceId]/components/use-keyboard-shortcuts'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkflowExecution } from '@/hooks/workflow/use-workflow-execution'
import { formatTemplate } from '@/i18n/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import {
  DeploymentControls,
  ExportControls,
} from '@/widgets/widgets/editor_workflow/components/control-bar/components'
import { useWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useWorkflowEditorCopy } from '@/widgets/widgets/editor_workflow/copy'

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
  const copy = useWorkflowEditorCopy()
  const { data: session } = useSession()
  const { workflowId, channelId } = useWorkflowRoute()
  const isRegistryLoading = useWorkflowRegistry((state) => state.isLoading)
  const activeWorkflowId = workflowId
  const { isExecuting, isWorkflowSessionReady, handleRunWorkflow, handleCancelExecution } =
    useWorkflowExecution()

  // User permissions - use stable activeWorkspaceId from registry instead of deriving from currentWorkflow
  const userPermissions = useUserPermissionsContext()

  // Local state
  const [, forceUpdate] = useState({})
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

  const currentBlocks = useWorkflowBlocks()
  const currentEdges = useWorkflowEdges()
  const runTriggers = listWorkflowRunTriggers(currentBlocks, currentEdges)

  // Shared condition for keyboard shortcut and button disabled state
  const isWorkflowBlocked =
    isExecuting || hasValidationErrors || !isWorkflowSessionReady || runTriggers.length === 0
  const canRunWithShortcut = runTriggers.length === 1

  // Register keyboard shortcut for running workflow
  useKeyboardShortcuts(
    () => {
      if (!isWorkflowBlocked && userPermissions.canEdit && canRunWithShortcut) {
        handleRunWorkflow({ triggerBlockId: runTriggers[0].blockId })
      }
    },
    isWorkflowBlocked || !userPermissions.canEdit || !canRunWithShortcut
  )

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry((state) =>
    state.readWorkflowDeploymentStatus(activeWorkflowId)
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
  }, [activeWorkflowId, deployedState, currentBlocks, currentEdges, isLoadingDeployedState])

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
      if (isExecuting || !userPermissions.canEdit || isAutoLayouting || hasLockedBlocks) {
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
    const isDisabled = isExecuting || !canEdit || isAutoLayouting || hasLockedBlocks

    const getTooltipText = () => {
      if (!canEdit) return copy.controlBar.autoLayoutPermissionRequired
      if (hasLockedBlocks) return copy.controlBar.autoLayoutLockedBlocks
      if (isExecuting) return copy.controlBar.autoLayoutWhileRunning
      if (isAutoLayouting) return copy.controlBar.applyingAutoLayout
      return copy.controlBar.autoLayout
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
              <span className='sr-only'>{copy.controlBar.autoLayout}</span>
            </Button>
          )}
        </TooltipTrigger>
        <TooltipContent command='Shift+L'>{getTooltipText()}</TooltipContent>
      </Tooltip>
    )
  }

  /**
   * Render run workflow button or cancel button when executing
   */
  const renderRunButton = () => {
    const isButtonDisabled = !isExecuting && (isWorkflowBlocked || !userPermissions.canEdit)

    // If currently executing, show cancel button
    if (isExecuting) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button className={getDangerButtonClass()} onClick={handleCancelExecution}>
              <X className={cn('h-3.5 w-3.5')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.controlBar.cancelExecution}</TooltipContent>
        </Tooltip>
      )
    }

    const getTooltipContent = () => {
      if (hasValidationErrors) {
        return (
          <div className='text-center'>
            <p className='font-medium text-destructive'>{copy.controlBar.workflowHasErrors}</p>
            <p className='text-xs'>{copy.controlBar.nestedSubflowsUnsupported}</p>
          </div>
        )
      }

      if (userPermissions.isLoading) {
        return copy.controlBar.checkingWorkflowPermissions
      }

      if (!userPermissions.canEdit) {
        return copy.controlBar.writePermissionRequiredToRunWorkflows
      }

      if (runTriggers.length === 0) {
        return 'Run requires a configured trigger block'
      }

      if (usageExceeded) {
        return (
          <div className='text-center'>
            <p className='font-medium text-destructive'>{copy.controlBar.usageLimitExceeded}</p>
            <p className='text-xs'>
              {formatTemplate(copy.controlBar.usageLimitExceededDescription, {
                currentUsage: usageData?.currentUsage?.toFixed(2) || 0,
                limit: usageData?.limit?.toFixed(2) || 0,
              })}
            </p>
          </div>
        )
      }

      return copy.controlBar.run
    }

    const handleRunClick = (triggerBlockId: string) => {
      if (usageExceeded) {
        return openSubscriptionSettings()
      }
      handleRunWorkflow({ triggerBlockId })
    }

    if (runTriggers.length > 1) {
      return (
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className='inline-flex'>
                <DropdownMenuTrigger asChild>
                  <Button
                    className={getPrimaryButtonClass('w-10 gap-0.5 px-1')}
                    disabled={isButtonDisabled}
                  >
                    <Play className={cn('h-3.5 w-3.5', 'fill-current stroke-current')} />
                    <ChevronDown className='h-3 w-3' />
                  </Button>
                </DropdownMenuTrigger>
              </span>
            </TooltipTrigger>
            <TooltipContent command={getKeyboardShortcutText('Enter', true)}>
              {getTooltipContent()}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align='end'
            sideOffset={6}
            className={cn(widgetHeaderMenuContentClassName, 'w-56 p-1')}
          >
            {runTriggers.map((trigger) => {
              const TriggerIcon = trigger.icon ?? Play
              return (
                <DropdownMenuItem
                  key={trigger.id}
                  className={widgetHeaderMenuItemClassName}
                  onSelect={(event) => {
                    event.preventDefault()
                    handleRunClick(trigger.blockId)
                  }}
                >
                  <span
                    className='relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-sm'
                    style={getIconTileStyle(trigger.color, '30')}
                    aria-hidden='true'
                  >
                    <TriggerIcon className='!h-3.5 !w-3.5' />
                  </span>
                  <span className={cn(widgetHeaderMenuTextClassName, 'min-w-0 flex-1 truncate')}>
                    {trigger.name}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            className={getPrimaryButtonClass()}
            onClick={() => handleRunClick(runTriggers[0].blockId)}
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
      {renderDeployButton()}
      {renderRunButton()}
    </div>
  )
}
