import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Info } from 'lucide-react'
import { Handle, type NodeProps, Position, useStore, useUpdateNodeInternals } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PopoverEnvironmentProvider } from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipEnvironmentProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { parseCronToHumanReadable } from '@/lib/schedules/utils'
import { cn, validateName } from '@/lib/utils'
import { type DiffStatus, hasDiffStatus } from '@/lib/workflows/diff/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCurrentWorkflow } from '@/hooks/workflow'
import { useExecutionStore } from '@/stores/execution/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowRegistry } from '@/stores/workflows/registry/types'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  useWorkflowStore,
} from '@/stores/workflows/workflow/store-client'
import { subscribeScheduleUpdated } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'
import {
  useOptionalWorkflowRoute,
  useWorkflowId,
} from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { useSubBlockValue } from './components/sub-block/hooks/use-sub-block-value'
import { buildSubBlockRows } from './components/sub-block/sub-block-layout'

const WORKFLOW_POPOVER_PORTAL_KEY = '__workflowPopoverPortal'

const logger = createLogger('WorkflowBlock')
const CANONICAL_SIDE_PANEL_TYPES = new Set(Object.keys(blockRegistry))

function formatSubBlockValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  const getItemDisplayValue = (item: unknown): string => {
    if (item === null || item === undefined || item === '') {
      return ''
    }

    if (typeof item === 'object' && !Array.isArray(item)) {
      const objectItem = item as Record<string, unknown>
      return String(
        objectItem.title || objectItem.name || objectItem.label || objectItem.id || '[Object]'
      )
    }

    return String(item)
  }

  if (Array.isArray(value)) {
    const nonEmptyItems = value.filter((item) => item !== null && item !== undefined && item !== '')
    if (nonEmptyItems.length === 0) {
      return '-'
    }

    if (nonEmptyItems.length === 1) {
      return getItemDisplayValue(nonEmptyItems[0])
    }

    if (nonEmptyItems.length === 2) {
      return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])}`
    }

    return `${getItemDisplayValue(nonEmptyItems[0])}, ${getItemDisplayValue(nonEmptyItems[1])} +${nonEmptyItems.length - 2}`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(
      ([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== ''
    )

    if (entries.length === 0) {
      return '-'
    }

    if (entries.length === 1) {
      const [entryKey, entryValue] = entries[0]
      const entryValueString = String(entryValue)
      const preview = entryValueString.length > 30 ? `${entryValueString.slice(0, 30)}...` : entryValueString
      return `${entryKey}: ${preview}`
    }

    const previewKeys = entries
      .slice(0, 2)
      .map(([entryKey]) => entryKey)
      .join(', ')

    return entries.length > 2 ? `${previewKeys} +${entries.length - 2}` : previewKeys
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    const serialized = JSON.stringify(value)
    return serialized === '{}' || serialized === '[]' ? '-' : serialized
  } catch {
    return String(value)
  }
}

interface WorkflowBlockProps {
  type: string
  config: BlockConfig
  name: string
  isActive?: boolean
  isPending?: boolean
  isPreview?: boolean
  readOnly?: boolean
  subBlockValues?: Record<string, any>
  blockState?: any // Block state data passed in preview mode
}

// Combine both interfaces into a single component - wrapped in memo for performance
export const WorkflowBlock = memo(
  function WorkflowBlock({ id, data, selected }: NodeProps<WorkflowBlockProps>) {
    const { type, config, name, isActive: dataIsActive, isPending } = data

    // State management
    const [, setIsConnecting] = useState(false)

    const [isEditing, setIsEditing] = useState(false)
    const [editedName, setEditedName] = useState('')
    const [isLoadingScheduleInfo, setIsLoadingScheduleInfo] = useState(false)
    const [scheduleInfo, setScheduleInfo] = useState<{
      scheduleTiming: string
      nextRunAt: string | null
      lastRanAt: string | null
      timezone: string
      status?: string
      isDisabled?: boolean
      id?: string
    } | null>(null)

    // Refs
    const blockRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const nameInputRef = useRef<HTMLInputElement>(null)
    const updateNodeInternals = useUpdateNodeInternals()
    const [tooltipContainer, setTooltipContainer] = useState<HTMLElement | null>(null)
    const [popoverContainer, setPopoverContainer] = useState<HTMLElement | null>(null)
    const viewportScale = useStore(
      useCallback((state: any) => {
        if (Array.isArray(state.transform)) {
          return state.transform[2] ?? 1
        }
        if (state.viewport && typeof state.viewport.zoom === 'number') {
          return state.viewport.zoom
        }
        return 1
      }, []),
      useCallback((a: number, b: number) => Math.abs(a - b) < 0.001, [])
    )
    const normalizedViewportScale = Number.isFinite(viewportScale) ? viewportScale : 1

    // Portal tooltips into the canvas viewport so they scale with React Flow zoom
    useEffect(() => {
      if (!blockRef.current) return
      const viewport = blockRef.current.closest('.react-flow__viewport') as HTMLElement | null
      const renderer = blockRef.current.closest('.react-flow__renderer') as HTMLElement | null
      const flow = blockRef.current.closest('.workflow-container') as HTMLElement | null
      setTooltipContainer(viewport ?? renderer)
      if (!flow) {
        setPopoverContainer(renderer)
        return
      }

      type WorkflowPopoverPortal = HTMLElement & {
        __workflowPopoverCount?: number
        __workflowPopoverCleanup?: () => void
      }

      let portal = (flow as any)[WORKFLOW_POPOVER_PORTAL_KEY] as WorkflowPopoverPortal | undefined
      if (!portal) {
        portal = document.createElement('div') as WorkflowPopoverPortal
        const createdPortal = portal
        portal.className = 'workflow-popover-portal'
        portal.style.position = 'fixed'
        portal.style.inset = '0'
        portal.style.pointerEvents = 'none'
        portal.style.zIndex = '70'
        document.body.appendChild(portal)

        let frameId = 0
        const updateClipPath = () => {
          frameId = 0
          const rect = flow.getBoundingClientRect()
          const top = Math.max(0, rect.top)
          const left = Math.max(0, rect.left)
          const right = Math.max(0, window.innerWidth - rect.right)
          const bottom = Math.max(0, window.innerHeight - rect.bottom)
          createdPortal.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`
        }
        const scheduleClipUpdate = () => {
          if (frameId) return
          frameId = window.requestAnimationFrame(updateClipPath)
        }

        scheduleClipUpdate()
        const resizeObserver = new ResizeObserver(scheduleClipUpdate)
        resizeObserver.observe(flow)
        window.addEventListener('resize', scheduleClipUpdate)
        window.addEventListener('scroll', scheduleClipUpdate, true)

        createdPortal.__workflowPopoverCleanup = () => {
          resizeObserver.disconnect()
          window.removeEventListener('resize', scheduleClipUpdate)
          window.removeEventListener('scroll', scheduleClipUpdate, true)
          if (frameId) {
            window.cancelAnimationFrame(frameId)
          }
          createdPortal.remove()
        }

          ; (flow as any)[WORKFLOW_POPOVER_PORTAL_KEY] = portal
      }

      if (!portal) return
      const activePortal = portal

      activePortal.__workflowPopoverCount = (activePortal.__workflowPopoverCount ?? 0) + 1
      setPopoverContainer(activePortal)

      return () => {
        activePortal.__workflowPopoverCount = Math.max(
          0,
          (activePortal.__workflowPopoverCount ?? 1) - 1
        )
        if (activePortal.__workflowPopoverCount === 0) {
          activePortal.__workflowPopoverCleanup?.()
          delete (flow as any)[WORKFLOW_POPOVER_PORTAL_KEY]
        }
      }
    }, [])

    // Use the clean abstraction for current workflow state
    const currentWorkflow = useCurrentWorkflow()
    const userPermissions = useUserPermissionsContext()
    const currentBlock = currentWorkflow.getBlockById(id)
    const isReadOnlyBlock = Boolean(data.isPreview || data.readOnly)
    const disableInNodeEditing =
      CANONICAL_SIDE_PANEL_TYPES.has(type) && !isReadOnlyBlock && !currentWorkflow.isDiffMode

    // In preview mode, use the blockState provided; otherwise use current workflow state
    const isEnabled = data.isPreview
      ? (data.blockState?.enabled ?? true)
      : (currentBlock?.enabled ?? true)

    // Get diff status from the block itself (set by diff engine)
    const diffStatus: DiffStatus =
      currentWorkflow.isDiffMode && currentBlock && hasDiffStatus(currentBlock)
        ? currentBlock.is_diff
        : undefined

    // Optimized: Single diff store subscription for all diff-related data
    const { diffAnalysis, isShowingDiff } = useWorkflowDiffStore(
      useCallback(
        (state) => ({
          diffAnalysis: state.diffAnalysis,
          isShowingDiff: state.isShowingDiff,
        }),
        []
      )
    )
    const isDeletedBlock = !isShowingDiff && diffAnalysis?.deleted_blocks?.includes(id)

    // Removed debug logging for performance
    const workflowRoute = useOptionalWorkflowRoute()
    const workflowChannelId = workflowRoute?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID
    const routeWorkflowId = workflowRoute?.workflowId ?? null

    const resolveActiveWorkflowId = useCallback(
      (state?: WorkflowRegistry) => {
        const sourceState = state ?? useWorkflowRegistry.getState()
        return sourceState.getActiveWorkflowId(workflowChannelId)
      },
      [workflowChannelId]
    )

    // Optimized: Single store subscription for all block properties
    const {
      storeHorizontalHandles,
      storeBlockHeight,
      storeBlockLayout,
      storeBlockAdvancedMode,
      storeBlockTriggerMode,
    } = useWorkflowStore(
      useCallback(
        (state) => {
          const block = state.blocks[id]
          return {
            storeHorizontalHandles: block?.horizontalHandles ?? true,
            storeBlockHeight: block?.height ?? 0,
            storeBlockLayout: block?.layout,
            storeBlockAdvancedMode: block?.advancedMode ?? false,
            storeBlockTriggerMode: block?.triggerMode ?? false,
          }
        },
        [id]
      )
    )

    // Get block properties from currentWorkflow when in diff mode, otherwise from workflow store
    const horizontalHandles = data.isPreview
      ? (data.blockState?.horizontalHandles ?? true) // In preview mode, use blockState and default to horizontal
      : currentWorkflow.isDiffMode
        ? (currentWorkflow.blocks[id]?.horizontalHandles ?? true)
        : storeHorizontalHandles

    const blockHeight = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.height ?? 0)
      : storeBlockHeight

    const blockWidth = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.layout?.measuredWidth ?? 0)
      : (storeBlockLayout?.measuredWidth ?? 0)

    const tooltipPortalContainer = tooltipContainer ?? undefined
    const popoverPortalContainer = popoverContainer ?? undefined
    const tooltipEnvironmentValue = useMemo(
      () => ({
        container: tooltipPortalContainer,
        scale: normalizedViewportScale,
      }),
      [tooltipPortalContainer, normalizedViewportScale]
    )
    const popoverEnvironmentValue = useMemo(
      () => ({
        container: popoverPortalContainer,
        scale: normalizedViewportScale,
        zIndex: 70,
      }),
      [normalizedViewportScale, popoverPortalContainer]
    )

    // Get per-block webhook status by checking if webhook is configured
    const activeWorkflowId = useWorkflowRegistry(resolveActiveWorkflowId)
    const resolvedWorkflowId = activeWorkflowId ?? routeWorkflowId

    // Optimized: Single SubBlockStore subscription for webhook info
    const blockWebhookStatus = useSubBlockStore(
      useCallback(
        (state) => {
          const blockValues = resolvedWorkflowId ? state.workflowValues[resolvedWorkflowId]?.[id] : null
          return !!(blockValues?.webhookProvider && blockValues?.webhookPath)
        },
        [resolvedWorkflowId, id]
      )
    )

    const blockAdvancedMode = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.advancedMode ?? false)
      : storeBlockAdvancedMode

    // Get triggerMode from currentWorkflow blocks when in diff mode, otherwise from workflow store
    const blockTriggerMode = currentWorkflow.isDiffMode
      ? (currentWorkflow.blocks[id]?.triggerMode ?? false)
      : storeBlockTriggerMode

    const displayAdvancedMode = data.isPreview
      ? (data.blockState?.advancedMode ?? false)
      : blockAdvancedMode

    const displayTriggerMode = data.isPreview
      ? (data.blockState?.triggerMode ?? false)
      : blockTriggerMode

    // Collaborative workflow actions
    const { collaborativeUpdateBlockName, collaborativeSetSubblockValue } =
      useCollaborativeWorkflow()

    // Clear credential-dependent fields when credential changes
    const prevCredRef = useRef<string | undefined>(undefined)
    useEffect(() => {
      if (isReadOnlyBlock || !userPermissions.canEdit || currentWorkflow.isDiffMode) return
      const workflowIdForBlock = resolveActiveWorkflowId() ?? routeWorkflowId
      if (!workflowIdForBlock) return
      const current = useSubBlockStore.getState().workflowValues[workflowIdForBlock]?.[id]
      if (!current) return
      const cred = current.credential?.value as string | undefined
      if (prevCredRef.current !== cred) {
        prevCredRef.current = cred
        const keys = Object.keys(current)
        const dependentKeys = keys.filter((k) => k !== 'credential')
        dependentKeys.forEach((k) => collaborativeSetSubblockValue(id, k, ''))
      }
    }, [
      id,
      collaborativeSetSubblockValue,
      resolveActiveWorkflowId,
      isReadOnlyBlock,
      userPermissions.canEdit,
      currentWorkflow.isDiffMode,
      routeWorkflowId,
    ])

    // Workflow store actions
    const updateBlockLayoutMetrics = useWorkflowStore((state) => state.updateBlockLayoutMetrics)

    // Execution store
    const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(id))
    const isActive = dataIsActive || isActiveBlock

    const currentWorkflowId = useWorkflowId()

    // Check if this is a trigger block
    const isTriggerBlock = config.category === 'triggers'
    const isWebhookTriggerBlock = type === 'webhook'

    const reactivateSchedule = async (scheduleId: string) => {
      try {
        const response = await fetch(`/api/schedules/${scheduleId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'reactivate' }),
        })

        if (response.ok) {
          // Use the current workflow ID from params instead of global state
          if (currentWorkflowId) {
            fetchScheduleInfo(currentWorkflowId)
          }
        } else {
          logger.error('Failed to reactivate schedule')
        }
      } catch (error) {
        logger.error('Error reactivating schedule:', error)
      }
    }

    const disableSchedule = async (scheduleId: string) => {
      try {
        const response = await fetch(`/api/schedules/${scheduleId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'disable' }),
        })

        if (response.ok) {
          // Refresh schedule info to show updated status
          if (currentWorkflowId) {
            fetchScheduleInfo(currentWorkflowId)
          }
        } else {
          logger.error('Failed to disable schedule')
        }
      } catch (error) {
        logger.error('Error disabling schedule:', error)
      }
    }

    const fetchScheduleInfo = useCallback(
      async (workflowId: string) => {
        if (!workflowId) return

        try {
          setIsLoadingScheduleInfo(true)

          const params = new URLSearchParams({
            workflowId,
            mode: 'schedule',
            blockId: id,
          })

          const response = await fetch(`/api/schedules?${params}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          })

          if (!response.ok) {
            setScheduleInfo(null)
            return
          }

          const data = await response.json()

          if (!data.schedule) {
            setScheduleInfo(null)
            return
          }

          const schedule = data.schedule
          const scheduleTimezone = schedule.timezone || 'UTC'

          setScheduleInfo({
            scheduleTiming: schedule.cronExpression
              ? parseCronToHumanReadable(schedule.cronExpression, scheduleTimezone)
              : 'Unknown schedule',
            nextRunAt: schedule.nextRunAt,
            lastRanAt: schedule.lastRanAt,
            timezone: scheduleTimezone,
            status: schedule.status,
            isDisabled: schedule.status === 'disabled',
            id: schedule.id,
          })
        } catch (error) {
          logger.error('Error fetching schedule info:', error)
          setScheduleInfo(null)
        } finally {
          setIsLoadingScheduleInfo(false)
        }
      },
      [id]
    )

    useEffect(() => {
      if (type === 'schedule' && currentWorkflowId) {
        fetchScheduleInfo(currentWorkflowId)
      } else {
        setScheduleInfo(null)
        setIsLoadingScheduleInfo(false) // Reset loading state when not a schedule block
      }

      // Listen for schedule updates from the schedule-config component
      const handleScheduleUpdate = ({
        workflowId: eventWorkflowId,
        blockId: eventBlockId,
      }: {
        workflowId: string
        blockId: string
      }) => {
        // Check if the update is for this workflow and block
        if (eventWorkflowId === currentWorkflowId && eventBlockId === id) {
          logger.debug('Schedule update event received, refetching schedule info')
          if (type === 'schedule') {
            fetchScheduleInfo(currentWorkflowId)
          }
        }
      }

      const unsubscribeScheduleUpdated = subscribeScheduleUpdated(
        { channelId: workflowChannelId, workflowId: currentWorkflowId },
        handleScheduleUpdate
      )

      // Cleanup function removes listener
      return () => {
        unsubscribeScheduleUpdated()
      }
    }, [type, currentWorkflowId, workflowChannelId, id, fetchScheduleInfo])

    // Update node internals when handles change
    useEffect(() => {
      updateNodeInternals(id)
    }, [id, horizontalHandles, updateNodeInternals])

    // Memoized debounce function to avoid recreating on every render
    const debounce = useCallback((func: (...args: any[]) => void, wait: number) => {
      let timeout: NodeJS.Timeout
      return (...args: any[]) => {
        clearTimeout(timeout)
        timeout = setTimeout(() => func(...args), wait)
      }
    }, [])

    // Add effect to observe size changes with debounced updates
    useEffect(() => {
      if (!contentRef.current) return

      let rafId: number
      const debouncedUpdate = debounce((dimensions: { width: number; height: number }) => {
        if (dimensions.height !== blockHeight || dimensions.width !== blockWidth) {
          updateBlockLayoutMetrics(id, dimensions)
          updateNodeInternals(id)
        }
      }, 100)

      const resizeObserver = new ResizeObserver((entries) => {
        // Cancel any pending animation frame
        if (rafId) {
          cancelAnimationFrame(rafId)
        }

        // Schedule the update on the next animation frame
        rafId = requestAnimationFrame(() => {
          for (const entry of entries) {
            const rect = entry.target.getBoundingClientRect()
            const height = entry.borderBoxSize[0]?.blockSize ?? rect.height
            const width = entry.borderBoxSize[0]?.inlineSize ?? rect.width
            debouncedUpdate({ width, height })
          }
        })
      })

      resizeObserver.observe(contentRef.current)

      return () => {
        resizeObserver.disconnect()
        if (rafId) {
          cancelAnimationFrame(rafId)
        }
      }
    }, [id, blockHeight, blockWidth, updateBlockLayoutMetrics, updateNodeInternals, debounce])

    // Subscribe to this block's subblock values to track changes for conditional rendering
    const blockSubBlockValues = useSubBlockStore(
      useCallback(
        (state) => {
          if (!resolvedWorkflowId) return {}
          return state.workflowValues[resolvedWorkflowId]?.[id] || {}
        },
        [resolvedWorkflowId, id]
      )
    )

    const getSubBlockStableKey = useCallback(
      (subBlock: SubBlockConfig, stateToUse: Record<string, any>): string => {
        if (subBlock.type === 'mcp-dynamic-args') {
          const serverValue = stateToUse.server?.value || 'no-server'
          const toolValue = stateToUse.tool?.value || 'no-tool'
          return `${id}-${subBlock.id}-${serverValue}-${toolValue}`
        }

        if (subBlock.type === 'mcp-tool-selector') {
          const serverValue = stateToUse.server?.value || 'no-server'
          return `${id}-${subBlock.id}-${serverValue}`
        }

        return `${id}-${subBlock.id}`
      },
      [id]
    )

    const subBlockRowsData = useMemo(() => {
      // Get the appropriate state for conditional evaluation
      let stateToUse: Record<string, any> = {}

      if (data.isPreview && data.subBlockValues) {
        // In preview mode, use the preview values
        stateToUse = data.subBlockValues
      } else if (currentWorkflow.isDiffMode && currentBlock) {
        // In diff mode, use the diff workflow's subblock values
        stateToUse = currentBlock.subBlocks || {}
      } else {
        // In normal mode, start from the rendered block state and overlay subblock-store values.
        // This keeps node previews populated on first paint before any panel interaction.
        const mergedState = currentBlock
          ? resolvedWorkflowId
            ? mergeSubblockState({ [id]: currentBlock }, resolvedWorkflowId, id)[id]
            : currentBlock
          : undefined
        stateToUse = mergedState?.subBlocks || currentBlock?.subBlocks || {}
      }

      const isPureTriggerBlock = config.category === 'triggers'
      const effectiveTrigger = displayTriggerMode || isPureTriggerBlock
      const rows = buildSubBlockRows({
        subBlocks: config.subBlocks,
        stateToUse,
        isAdvancedMode: displayAdvancedMode,
        isTriggerMode: effectiveTrigger,
        isPureTriggerBlock,
        availableTriggerIds: config.triggers?.available,
        hideFromPreview: data.isPreview,
      })

      // Return both rows and state for stable key generation
      return { rows, stateToUse }
    }, [
      config.subBlocks,
      id,
      displayAdvancedMode,
      displayTriggerMode,
      data.isPreview,
      data.subBlockValues,
      currentWorkflow.isDiffMode,
      currentBlock,
      blockSubBlockValues,
      activeWorkflowId,
      resolvedWorkflowId,
    ])

    // Extract rows and state from the memoized value
    const subBlockRows = subBlockRowsData.rows
    const subBlockState = subBlockRowsData.stateToUse
    const flattenedSubBlocks = useMemo(() => subBlockRows.flat(), [subBlockRows])
    const conditionRows = useMemo(() => {
      if (type !== 'condition') {
        return [] as Array<{ id: string; title: string; value: string }>
      }

      const fallbackRows = [
        { id: `${id}-if`, title: 'if', value: '' },
        { id: `${id}-else`, title: 'else', value: '' },
      ]
      const rawConditions = subBlockState.conditions?.value

      if (typeof rawConditions !== 'string' || rawConditions.trim().length === 0) {
        return fallbackRows
      }

      try {
        const parsedConditions = JSON.parse(rawConditions) as unknown
        if (!Array.isArray(parsedConditions) || parsedConditions.length === 0) {
          return fallbackRows
        }

        return parsedConditions.map((conditionItem, index) => {
          const condition = conditionItem as { id?: unknown; value?: unknown }
          return {
            id:
              typeof condition.id === 'string' && condition.id.length > 0
                ? condition.id
                : `${id}-cond-${index}`,
            title:
              index === 0 ? 'if' : index === parsedConditions.length - 1 ? 'else' : 'else if',
            value: typeof condition.value === 'string' ? condition.value : '',
          }
        })
      } catch {
        return fallbackRows
      }
    }, [id, subBlockState.conditions?.value, type])
    const shouldRenderInNodeSubBlocks = subBlockRows.length > 0
    const shouldShowErrorHandle =
      type === 'condition' ||
      (type !== 'response' && config.category !== 'triggers' && !displayTriggerMode)
    const useHorizontalErrorHandle = type === 'condition' || horizontalHandles

    useEffect(() => {
      if (type === 'condition') {
        updateNodeInternals(id)
      }
    }, [conditionRows.length, id, type, updateNodeInternals])

    // Name editing handlers
    const handleNameClick = (e: React.MouseEvent) => {
      e.stopPropagation() // Prevent drag handler from interfering
      if (isReadOnlyBlock) return
      if (disableInNodeEditing) return
      setEditedName(name)
      setIsEditing(true)
    }

    // Auto-focus the input when edit mode is activated
    useEffect(() => {
      if (isEditing && nameInputRef.current) {
        nameInputRef.current.focus()
      }
    }, [isEditing])

    // Handle node name change with validation
    const handleNodeNameChange = (newName: string) => {
      const validatedName = validateName(newName)
      setEditedName(validatedName.slice(0, 18))
    }

    const handleNameSubmit = () => {
      if (isReadOnlyBlock) {
        setIsEditing(false)
        return
      }
      const trimmedName = editedName.trim().slice(0, 18)
      if (trimmedName && trimmedName !== name) {
        collaborativeUpdateBlockName(id, trimmedName)
      }
      setIsEditing(false)
    }

    const handleNameKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleNameSubmit()
      } else if (e.key === 'Escape') {
        setIsEditing(false)
      }
    }

    // Check webhook indicator
    const showWebhookIndicator = isWebhookTriggerBlock && blockWebhookStatus

    const shouldShowScheduleBadge =
      type === 'schedule' && !isLoadingScheduleInfo && scheduleInfo !== null
    const [childActiveVersion, setChildActiveVersion] = useState<number | null>(null)
    const [childIsDeployed, setChildIsDeployed] = useState<boolean>(false)
    const [isLoadingChildVersion, setIsLoadingChildVersion] = useState(false)

    // Use the store directly for real-time updates when workflow dropdown changes
    const [workflowIdFromStore] = useSubBlockValue<string>(id, 'workflowId')

    // Determine if this is a workflow block (child workflow selector) and fetch child status
    const isWorkflowSelector = type === 'workflow' || type === 'workflow_input'
    let childWorkflowId: string | undefined
    if (!data.isPreview) {
      // Use store value for real-time updates
      const val = workflowIdFromStore
      if (typeof val === 'string' && val.trim().length > 0) {
        childWorkflowId = val
      }
    } else if (data.isPreview && data.subBlockValues?.workflowId?.value) {
      const val = data.subBlockValues.workflowId.value
      if (typeof val === 'string' && val.trim().length > 0) childWorkflowId = val
    }

    // Fetch active deployment version for the selected child workflow
    useEffect(() => {
      let cancelled = false
      const fetchActiveVersion = async (wfId: string) => {
        try {
          setIsLoadingChildVersion(true)
          const res = await fetch(`/api/workflows/${wfId}/deployments`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          })
          if (!res.ok) {
            if (!cancelled) {
              setChildActiveVersion(null)
              setChildIsDeployed(false)
            }
            return
          }
          const json = await res.json()
          const versions = Array.isArray(json?.data?.versions)
            ? json.data.versions
            : Array.isArray(json?.versions)
              ? json.versions
              : []
          const active = versions.find((v: any) => v.isActive)
          if (!cancelled) {
            const v = active ? Number(active.version) : null
            setChildActiveVersion(v)
            setChildIsDeployed(v != null)
          }
        } catch {
          if (!cancelled) {
            setChildActiveVersion(null)
            setChildIsDeployed(false)
          }
        } finally {
          if (!cancelled) setIsLoadingChildVersion(false)
        }
      }

      // Always fetch when childWorkflowId changes
      if (childWorkflowId) {
        void fetchActiveVersion(childWorkflowId)
      } else {
        setChildActiveVersion(null)
        setChildIsDeployed(false)
      }
      return () => {
        cancelled = true
      }
    }, [childWorkflowId])

    return (
      <TooltipEnvironmentProvider value={tooltipEnvironmentValue}>
        <PopoverEnvironmentProvider value={popoverEnvironmentValue}>
          <div className='group relative'>
            <Card
              ref={blockRef}
              className={cn(
                'relative cursor-default select-none rounded-md border border-border shadow-xs',
                'transition-block-bg transition-ring',
                'w-[320px]',
                !isEnabled && 'shadow-sm',
                isActive && 'animate-pulse-ring ring-2 ring-blue-500',
                isPending && 'ring-2 ring-yellow-500',
                // Diff highlighting
                diffStatus === 'new' && 'bg-green-50/50 ring-2 ring-green-500 dark:bg-green-900/10',
                diffStatus === 'edited' &&
                'bg-orange-50/50 ring-2 ring-orange-500 dark:bg-orange-900/10',
                // Deleted block highlighting (in original workflow)
                isDeletedBlock && 'bg-red-50/50 ring-2 ring-red-500 dark:bg-red-900/10',
                'z-[20]'
              )}
              style={
                selected
                  ? { borderColor: config.bgColor || 'hsl(var(--foreground))', borderWidth: '1px' }
                  : undefined
              }
            >
              {/* Show debug indicator for pending blocks */}
              {isPending && (
                <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-yellow-500 px-2 py-0.5 text-white text-xs'>
                  Next Step
                </div>
              )}

              {!isReadOnlyBlock && (
                <ActionBar
                  blockId={id}
                  blockType={type}
                  workflowId={currentWorkflowId}
                  channelId={workflowChannelId}
                  disabled={!userPermissions.canEdit}
                />
              )}
              {/* Connection Blocks - Don't show for trigger blocks or blocks in trigger mode */}
              {config.category !== 'triggers' && !displayTriggerMode && !isReadOnlyBlock && (
                <ConnectionBlocks
                  blockId={id}
                  setIsConnecting={setIsConnecting}
                  isDisabled={!userPermissions.canEdit || isReadOnlyBlock}
                  horizontalHandles={horizontalHandles}
                />
              )}

              {/* Input Handle - Don't show for trigger blocks or blocks in trigger mode */}
              {config.category !== 'triggers' && !displayTriggerMode && (
                <Handle
                  type='target'
                  position={horizontalHandles ? Position.Left : Position.Top}
                  id='target'
                  className={cn(
                    horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                    '!bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none',
                    '!z-[30]',
                    'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                    horizontalHandles
                      ? 'hover:!w-[10px] hover:!left-[-10px]'
                      : 'hover:!h-[10px] hover:!top-[-10px]',
                    '!cursor-crosshair',
                    'transition-[colors] duration-150',
                    horizontalHandles ? '!left-[-7px]' : '!top-[-7px]'
                  )}
                  style={{
                    ...(horizontalHandles
                      ? { top: '50%', transform: 'translateY(-50%)' }
                      : { left: '50%', transform: 'translateX(-50%)' }),
                  }}
                  data-nodeid={id}
                  data-handleid='target'
                  isConnectableStart={false}
                  isConnectableEnd={!isReadOnlyBlock}
                  isValidConnection={(connection) => connection.source !== id}
                />
              )}

              {/* Block Header */}
              <div
                className={cn(
                  'workflow-drag-handle flex cursor-grab items-center justify-between p-3 [&:active]:cursor-grabbing',
                  shouldRenderInNodeSubBlocks && 'border-b'
                )}
                onMouseDown={(e) => {
                  e.stopPropagation()
                }}
              >
                <div className='flex min-w-0 flex-1 items-center gap-3'>
                  <div
                    className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
                    style={{
                      backgroundColor: isEnabled
                        ? config.bgColor
                          ? `${config.bgColor}20`
                          : undefined
                        : 'gray',
                      color: isEnabled ? config.bgColor || undefined : 'white',
                    }}
                  >
                    <config.icon className={'h-5 w-5'} />
                  </div>
                  <div className='min-w-0'>
                    {isEditing ? (
                      <input
                        ref={nameInputRef}
                        type='text'
                        value={editedName}
                        onChange={(e) => handleNodeNameChange(e.target.value)}
                        onBlur={handleNameSubmit}
                        onKeyDown={handleNameKeyDown}
                        className='border-none bg-transparent p-0 font-medium text-md outline-none'
                        maxLength={18}
                      />
                    ) : (
                      <span
                        className={cn(
                          'inline-block cursor-text font-medium text-md hover:text-muted-foreground',
                          !isEnabled && 'text-muted-foreground',
                          (disableInNodeEditing || isReadOnlyBlock) &&
                          'cursor-default hover:text-foreground'
                        )}
                        onClick={handleNameClick}
                        title={name}
                        style={{
                          maxWidth: !isEnabled ? '140px' : '180px',
                        }}
                      >
                        {name}
                      </span>
                    )}
                  </div>
                </div>
                <div className='flex flex-shrink-0 items-center gap-2'>
                  {isWorkflowSelector && childWorkflowId && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className='relative mr-1 flex items-center justify-center'>
                          <div
                            className={cn(
                              'h-2.5 w-2.5 rounded-full',
                              childIsDeployed ? 'bg-green-500' : 'bg-red-500'
                            )}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side='top' className='px-3 py-2'>
                        <span className='text-sm'>
                          {childIsDeployed
                            ? isLoadingChildVersion
                              ? 'Deployed'
                              : childActiveVersion != null
                                ? `Deployed (v${childActiveVersion})`
                                : 'Deployed'
                            : 'Not Deployed'}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {!isEnabled && (
                    <Badge
                      variant='secondary'
                      className='bg-gray-100 text-gray-500 hover:bg-gray-100'
                    >
                      Disabled
                    </Badge>
                  )}
                  {/* Schedule indicator badge - displayed for schedule trigger blocks with active schedules */}
                  {shouldShowScheduleBadge && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant='outline'
                          className={cn(
                            'flex items-center gap-1 font-normal text-xs',
                            !isReadOnlyBlock && 'cursor-pointer',
                            scheduleInfo?.isDisabled
                              ? 'border-yellow-200 bg-yellow-50 text-yellow-600 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400'
                              : 'border-green-200 bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400'
                          )}
                          onClick={
                            !isReadOnlyBlock && userPermissions.canEdit && scheduleInfo?.id
                              ? scheduleInfo.isDisabled
                                ? () => reactivateSchedule(scheduleInfo.id!)
                                : () => disableSchedule(scheduleInfo.id!)
                              : undefined
                          }
                        >
                          <div className='relative mr-0.5 flex items-center justify-center'>
                            <div
                              className={cn(
                                'absolute h-3 w-3 rounded-full',
                                scheduleInfo?.isDisabled ? 'bg-yellow-500/20' : 'bg-green-500/20'
                              )}
                            />
                            <div
                              className={cn(
                                'relative h-2 w-2 rounded-full',
                                scheduleInfo?.isDisabled ? 'bg-yellow-500' : 'bg-green-500'
                              )}
                            />
                          </div>
                          {scheduleInfo?.isDisabled ? 'Disabled' : 'Scheduled'}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side='top' className='max-w-[300px] p-4'>
                        {isReadOnlyBlock ? (
                          <p className='text-sm'>Schedules are view-only in preview mode.</p>
                        ) : scheduleInfo?.isDisabled ? (
                          <p className='text-sm'>
                            This schedule is currently disabled. Click the badge to reactivate it.
                          </p>
                        ) : (
                          <p className='text-sm'>Click the badge to disable this schedule.</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {/* Webhook indicator badge - displayed for webhook trigger blocks */}
                  {showWebhookIndicator && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant='outline'
                          className='flex items-center gap-1 border-green-200 bg-green-50 font-normal text-green-600 text-xs hover:bg-green-50 dark:bg-green-900/20 dark:text-green-400'
                        >
                          <div className='relative mr-0.5 flex items-center justify-center'>
                            <div className='absolute h-3 w-3 rounded-full bg-green-500/20' />
                            <div className='relative h-2 w-2 rounded-full bg-green-500' />
                          </div>
                          Webhook
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side='top' className='max-w-[300px] p-4'>
                        <p className='text-muted-foreground text-sm'>
                          This workflow is triggered by a webhook.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {config.docsLink ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-7 p-1 text-gray-500'
                          onClick={(e) => {
                            e.stopPropagation()
                            window.open(config.docsLink, '_target', 'noopener,noreferrer')
                          }}
                        >
                          <BookOpen className='h-5 w-5' />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side='top'>See Docs</TooltipContent>
                    </Tooltip>
                  ) : (
                    config.longDescription && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant='ghost' size='icon' className='h-7 p-1 text-gray-500'>
                            <Info className='h-5 w-5' />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side='top' className='max-w-[300px] p-4'>
                          <div className='space-y-3'>
                            <div>
                              <p className='mb-1 font-medium text-sm'>Description</p>
                              <p className='text-muted-foreground text-sm'>
                                {config.longDescription}
                              </p>
                            </div>
                            {config.outputs && Object.keys(config.outputs).length > 0 && (
                              <div>
                                <p className='mb-1 font-medium text-sm'>Output</p>
                                <div className='text-sm'>
                                  {Object.entries(config.outputs).map(([key, value]) => (
                                    <div key={key} className='mb-1'>
                                      <span className='text-muted-foreground'>{key}</span>{' '}
                                      <span className='text-green-500'>
                                        {typeof value === 'object' && value !== null && 'type' in value
                                          ? value.type
                                          : value}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  )}
                </div>
              </div>

              {/* Block Content - Only render if there are subblocks */}
              {shouldRenderInNodeSubBlocks && (
                <div
                  ref={contentRef}
                  className='cursor-pointer p-2'
                  onMouseDown={(e) => {
                    e.stopPropagation()
                  }}
                >
                  <div className='flex flex-col gap-2'>
                    {type === 'condition'
                      ? conditionRows.map((conditionRow) => (
                        <div key={conditionRow.id} className='flex items-center gap-2'>
                          <p
                            className='min-w-0 truncate text-[14px] text-muted-foreground capitalize'
                            title={conditionRow.title}
                          >
                            {conditionRow.title}
                          </p>
                          <p
                            className='min-w-0 flex-1 truncate text-right text-[14px]'
                            title={conditionRow.value}
                          >
                            {formatSubBlockValue(conditionRow.value)}
                          </p>
                        </div>
                      ))
                      : flattenedSubBlocks.map((subBlock, index) => {
                        const stableKey = `${getSubBlockStableKey(subBlock, subBlockState)}-${index}`
                        const rawValue = subBlockState[subBlock.id]?.value
                        const displayValue = formatSubBlockValue(rawValue)

                        return (
                          <div key={stableKey} className='flex items-center gap-2'>
                            <p
                              className='min-w-0 truncate text-[14px] text-muted-foreground capitalize'
                              title={subBlock.title ?? subBlock.id}
                            >
                              {subBlock.title ?? subBlock.id}
                            </p>
                            <p
                              className='min-w-0 flex-1 truncate text-right text-[14px]'
                              title={displayValue}
                            >
                              {displayValue}
                            </p>
                          </div>
                        )
                      })}
                    {type === 'condition' && shouldShowErrorHandle && (
                      <div className='flex items-center gap-2'>
                        <p
                          className='min-w-0 truncate text-[14px] text-muted-foreground capitalize'
                          title='error'
                        >
                          error
                        </p>
                        <p className='min-w-0 flex-1 truncate text-right text-[14px]' title='-'>
                          -
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Output Handle */}
              {type === 'condition' ? (
                <>
                  {conditionRows.map((conditionRow, rowIndex) => (
                    <Handle
                      key={`condition-handle-${conditionRow.id}`}
                      type='source'
                      position={Position.Right}
                      id={`condition-${conditionRow.id}`}
                      className={cn(
                        '!w-[7px] !h-5',
                        '!bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none',
                        '!z-[30]',
                        'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                        'hover:!w-[10px] hover:!right-[-10px]',
                        '!cursor-crosshair',
                        'transition-[colors] duration-150',
                        '!right-[-7px]'
                      )}
                      style={{
                        top: `${60 + rowIndex * 29}px`,
                        transform: 'translateY(-50%)',
                      }}
                      data-nodeid={id}
                      data-handleid={`condition-${conditionRow.id}`}
                      isConnectableStart={!isReadOnlyBlock}
                      isConnectableEnd={false}
                      isValidConnection={(connection) => connection.target !== id}
                    />
                  ))}
                </>
              ) : type !== 'response' && (
                <>
                  <Handle
                    type='source'
                    position={horizontalHandles ? Position.Right : Position.Bottom}
                    id='source'
                    className={cn(
                      horizontalHandles ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                      '!bg-slate-300 dark:!bg-slate-500 !rounded-xs !border-none',
                      '!z-[30]',
                      'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                      horizontalHandles
                        ? 'hover:!w-[10px] hover:!right-[-10px]'
                        : 'hover:!h-[10px] hover:!bottom-[-10px]',
                      '!cursor-crosshair',
                      'transition-[colors] duration-150',
                      horizontalHandles ? '!right-[-7px]' : '!bottom-[-7px]'
                    )}
                    style={{
                      ...(horizontalHandles
                        ? { top: '50%', transform: 'translateY(-50%)' }
                        : { left: '50%', transform: 'translateX(-50%)' }),
                    }}
                    data-nodeid={id}
                    data-handleid='source'
                    isConnectableStart={!isReadOnlyBlock}
                    isConnectableEnd={false}
                    isValidConnection={(connection) => connection.target !== id}
                  />
                </>
              )}

              {shouldShowErrorHandle && (
                <Handle
                  type='source'
                  position={useHorizontalErrorHandle ? Position.Right : Position.Bottom}
                  id='error'
                  className={cn(
                    useHorizontalErrorHandle ? '!w-[7px] !h-5' : '!w-5 !h-[7px]',
                    '!bg-red-400 dark:!bg-red-500 !rounded-xs !border-none',
                    '!z-[30]',
                    'group-hover:!shadow-[0_0_0_3px_rgba(248,113,113,0.15)]',
                    useHorizontalErrorHandle
                      ? 'hover:!w-[10px] hover:!right-[-10px]'
                      : 'hover:!h-[10px] hover:!bottom-[-10px]',
                    '!cursor-crosshair',
                    'transition-[colors] duration-150'
                  )}
                  style={{
                    position: 'absolute',
                    ...(type === 'condition'
                      ? {
                        right: '-7px',
                        top: `${60 + conditionRows.length * 29}px`,
                        bottom: 'auto',
                        transform: 'translateY(-50%)',
                      }
                      : useHorizontalErrorHandle
                        ? {
                          right: '-7px',
                          top: 'auto',
                          bottom: '30px',
                          transform: 'translateY(0)',
                        }
                        : {
                          bottom: '-7px',
                          left: 'auto',
                          right: '30px',
                          transform: 'translateX(0)',
                        }),
                  }}
                  data-nodeid={id}
                  data-handleid='error'
                  isConnectableStart={!isReadOnlyBlock}
                  isConnectableEnd={false}
                  isValidConnection={(connection) => connection.target !== id}
                />
              )}
            </Card>
          </div>
        </PopoverEnvironmentProvider>
      </TooltipEnvironmentProvider>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison function to prevent unnecessary re-renders
    // Only re-render if these specific props change
    // Return TRUE to skip re-render, FALSE to re-render
    const shouldSkipRender =
      prevProps.id === nextProps.id &&
      prevProps.data.type === nextProps.data.type &&
      prevProps.data.name === nextProps.data.name &&
      prevProps.data.isActive === nextProps.data.isActive &&
      prevProps.data.isPending === nextProps.data.isPending &&
      prevProps.data.isPreview === nextProps.data.isPreview &&
      prevProps.data.config === nextProps.data.config &&
      prevProps.data.subBlockValues === nextProps.data.subBlockValues &&
      prevProps.data.blockState === nextProps.data.blockState &&
      prevProps.selected === nextProps.selected &&
      prevProps.dragging === nextProps.dragging

    return shouldSkipRender
  }
)
