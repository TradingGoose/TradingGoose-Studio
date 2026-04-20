import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, type Node, type NodeProps, Position, useStore, useUpdateNodeInternals } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PopoverEnvironmentProvider } from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipEnvironmentProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn, validateName } from '@/lib/utils'
import { resolveDisplayedSubBlockValue } from '@/lib/workflows/subblock-values'
import { useBlock, useBlockProtection, useWorkflowMutations } from '@/lib/yjs/use-workflow-doc'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { useExecutionStore } from '@/stores/execution/store'
import { subscribeScheduleUpdated } from '@/widgets/widgets/editor_workflow/components/workflow-editor/canvas/workflow-editor-event-bus'
import {
  useWorkflowChannelId,
  useWorkflowId,
} from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { ActionBar } from './components/action-bar/action-bar'
import { ConnectionBlocks } from './components/connection-blocks/connection-blocks'
import { useSubBlockValue } from './components/sub-block/hooks/use-sub-block-value'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'

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
      const preview =
        entryValueString.length > 30 ? `${entryValueString.slice(0, 30)}...` : entryValueString
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

function parseJsonDetailValue(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

interface JsonPreviewFieldRow {
  title: string
  value: string
}

const JSON_PREVIEW_ROW_LIMIT = 8

function buildJsonPreviewFieldRows(value: unknown): JsonPreviewFieldRow[] {
  const parsedValue = parseJsonDetailValue(value)

  if (parsedValue === null || parsedValue === undefined || parsedValue === '') {
    return [{ title: 'value', value: '-' }]
  }

  if (Array.isArray(parsedValue)) {
    if (parsedValue.length === 0) {
      return [{ title: 'items', value: '0' }]
    }

    const firstItem = parsedValue[0]
    if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
      const entries = Object.entries(firstItem)
      const rows = entries.slice(0, JSON_PREVIEW_ROW_LIMIT).map(([key, entryValue]) => ({
        title: key,
        value: formatSubBlockValue(entryValue),
      }))

      if (entries.length > JSON_PREVIEW_ROW_LIMIT) {
        rows.push({
          title: 'fields',
          value: `+${entries.length - JSON_PREVIEW_ROW_LIMIT} more`,
        })
      }

      if (parsedValue.length > 1) {
        rows.push({
          title: 'items',
          value: String(parsedValue.length),
        })
      }

      return rows
    }

    const rows = parsedValue
      .slice(0, JSON_PREVIEW_ROW_LIMIT)
      .map((item, index) => ({ title: `[${index}]`, value: formatSubBlockValue(item) }))

    if (parsedValue.length > JSON_PREVIEW_ROW_LIMIT) {
      rows.push({
        title: 'items',
        value: `+${parsedValue.length - JSON_PREVIEW_ROW_LIMIT} more`,
      })
    }

    return rows
  }

  if (typeof parsedValue === 'object') {
    const entries = Object.entries(parsedValue)
    if (entries.length === 0) {
      return [{ title: 'object', value: '{}' }]
    }

    const rows = entries.slice(0, JSON_PREVIEW_ROW_LIMIT).map(([key, entryValue]) => ({
      title: key,
      value: formatSubBlockValue(entryValue),
    }))

    if (entries.length > JSON_PREVIEW_ROW_LIMIT) {
      rows.push({
        title: 'fields',
        value: `+${entries.length - JSON_PREVIEW_ROW_LIMIT} more`,
      })
    }

    return rows
  }

  return [{ title: 'value', value: formatSubBlockValue(parsedValue) }]
}

function formatSkillInputValue(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    return '-'
  }

  const resolvedNames = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const storedSkill = item as { skillId?: string; name?: string }
      if (typeof storedSkill.name === 'string' && storedSkill.name.length > 0) {
        return storedSkill.name
      }

      return storedSkill.skillId ?? null
    })
    .filter((name): name is string => typeof name === 'string' && name.length > 0)

  if (resolvedNames.length === 0) {
    return '-'
  }

  if (resolvedNames.length === 1) {
    return resolvedNames[0]
  }

  if (resolvedNames.length === 2) {
    return `${resolvedNames[0]}, ${resolvedNames[1]}`
  }

  return `${resolvedNames[0]}, ${resolvedNames[1]} +${resolvedNames.length - 2}`
}

interface WorkflowBlockProps extends Record<string, unknown> {
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

type WorkflowBlockNode = Node<WorkflowBlockProps, 'workflowBlock'>

// Combine both interfaces into a single component - wrapped in memo for performance
export const WorkflowBlock = memo(
  function WorkflowBlock({ id, data, selected }: NodeProps<WorkflowBlockNode>) {
    const { type, config, name, isActive: dataIsActive, isPending } = data

    // State management
    const [, setIsConnecting] = useState(false)

    const [isEditing, setIsEditing] = useState(false)
    const [editedName, setEditedName] = useState('')
    const [isLoadingScheduleInfo, setIsLoadingScheduleInfo] = useState(false)
    const [scheduleInfo, setScheduleInfo] = useState<{ isDisabled: boolean; id?: string } | null>(
      null
    )

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
      if (data.isPreview) return
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
    }, [data.isPreview])

    // Use the clean abstraction for current workflow state
    const userPermissions = useUserPermissionsContext()
    const currentBlock = useBlock(id)
    const isCurrentBlockProtected = useBlockProtection(id)
    const isReadOnlyBlock = Boolean(data.isPreview || data.readOnly)
    const isLocked = data.isPreview
      ? (data.blockState?.locked ?? false)
      : (currentBlock?.locked ?? false)
    const isProtectedByLock = data.isPreview || !currentBlock ? isLocked : isCurrentBlockProtected
    const disableInNodeEditing =
      (CANONICAL_SIDE_PANEL_TYPES.has(type) && !isReadOnlyBlock) || isProtectedByLock

    // In preview mode, use the blockState provided; otherwise use current workflow state
    const isEnabled = data.isPreview
      ? (data.blockState?.enabled ?? true)
      : (currentBlock?.enabled ?? true)

    // Read block properties from Yjs doc
    const yjsMutations = useWorkflowMutations()
    const currentYjsBlock = currentBlock
    const workflowChannelId = useWorkflowChannelId()

    // Derive block properties from Yjs blocks
    const {
      storeHorizontalHandles,
      storeBlockLayout,
      storeBlockAdvancedMode,
      storeBlockTriggerMode,
    } = useMemo(() => {
      const block = currentYjsBlock
      return {
        storeHorizontalHandles: block?.horizontalHandles ?? true,
        storeBlockLayout: block?.layout,
        storeBlockAdvancedMode: block?.advancedMode ?? false,
        storeBlockTriggerMode: block?.triggerMode ?? false,
      }
    }, [currentYjsBlock])

    const horizontalHandles = data.isPreview
      ? (data.blockState?.horizontalHandles ?? true)
      : storeHorizontalHandles

    const blockHeight = storeBlockLayout?.measuredHeight ?? currentYjsBlock?.height ?? 0

    const blockWidth = storeBlockLayout?.measuredWidth ?? 0

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

    // Get per-block webhook status by checking if webhook is configured (from Yjs blocks)
    const blockWebhookStatus = useMemo(() => {
      const subBlocks = currentYjsBlock?.subBlocks
      if (!subBlocks) return false

      const getVal = (key: string) => subBlocks[key]?.value
      const hasLegacyWebhookConfig = Boolean(
        getVal('webhookProvider') && (getVal('webhookPath') || getVal('triggerPath'))
      )
      const hasTriggerManagedWebhookConfig = Boolean(
        getVal('triggerPath') && (getVal('webhookId') || getVal('triggerId'))
      )

      return hasLegacyWebhookConfig || hasTriggerManagedWebhookConfig
    }, [currentYjsBlock?.subBlocks])

    const blockAdvancedMode = storeBlockAdvancedMode

    const blockTriggerMode = storeBlockTriggerMode

    const displayAdvancedMode = data.isPreview
      ? (data.blockState?.advancedMode ?? false)
      : blockAdvancedMode

    const displayTriggerMode = data.isPreview
      ? (data.blockState?.triggerMode ?? false)
      : blockTriggerMode

    // Collaborative workflow actions
    const { collaborativeUpdateBlockName, collaborativeSetSubblockValue } =
      useWorkflowEditorActions()

    // Clear credential-dependent fields when credential changes
    const prevCredRef = useRef<string | undefined>(undefined)
    useEffect(() => {
      if (isReadOnlyBlock || !userPermissions.canEdit) return
      const subBlocks = currentYjsBlock?.subBlocks
      if (!subBlocks) return
      const cred = subBlocks.credential?.value as string | undefined
      if (prevCredRef.current !== cred) {
        prevCredRef.current = cred
        const keys = Object.keys(subBlocks)
        const dependentKeys = keys.filter((k) => k !== 'credential')
        dependentKeys.forEach((k) => collaborativeSetSubblockValue(id, k, ''))
      }
    }, [
      id,
      collaborativeSetSubblockValue,
      currentYjsBlock?.subBlocks,
      isReadOnlyBlock,
      userPermissions.canEdit,
    ])

    // Workflow store actions - use Yjs mutations
    const updateBlockLayoutMetrics = yjsMutations.updateBlockLayoutMetrics

    // Execution store
    const isActiveBlock = useExecutionStore((state) => state.activeBlockIds.has(id))
    const isActive = dataIsActive || isActiveBlock

    const currentWorkflowId = useWorkflowId()

    // Check if this is a webhook-capable trigger block
    const isWebhookTriggerBlock = type === 'webhook' || type === 'generic_webhook'

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
          setScheduleInfo({
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
      if (data.isPreview) return
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
    }, [
      data.isPreview,
      id,
      blockHeight,
      blockWidth,
      updateBlockLayoutMetrics,
      updateNodeInternals,
      debounce,
    ])

    // Subscribe to this block's subblock values from Yjs for conditional rendering
    const blockSubBlockValues = currentYjsBlock?.subBlocks || {}

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
      } else {
        // In normal mode, use Yjs blocks which already contain the merged subblock state.
        stateToUse = currentBlock?.subBlocks || {}
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
        hideFromPreview: true,
        triggerSubBlockOwner: 'all',
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
      currentBlock,
      blockSubBlockValues,
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
            title: index === 0 ? 'if' : index === parsedConditions.length - 1 ? 'else' : 'else if',
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

    const shouldShowScheduleBadge = type === 'schedule' && !isLoadingScheduleInfo
    const hasScheduleInfo = scheduleInfo !== null
    let onScheduleToggle: (() => void) | undefined
    if (userPermissions.canEdit && scheduleInfo?.id) {
      const scheduleId = scheduleInfo.id
      onScheduleToggle = scheduleInfo.isDisabled
        ? () => reactivateSchedule(scheduleId)
        : () => disableSchedule(scheduleId)
    }

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

    const blockAccentColor = config.bgColor || 'hsl(var(--muted-foreground))'
    const hasPriorityRing = isActive || isPending

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
                !hasPriorityRing && 'hover:ring-1 hover:ring-[var(--block-hover-color)]',
                'z-[20]'
              )}
              style={
                {
                  '--block-hover-color': blockAccentColor,
                  ...(selected ? { borderColor: blockAccentColor, borderWidth: '1px' } : {}),
                } as CSSProperties & Record<'--block-hover-color', string>
              }
            >
              {/* Show debug indicator for pending blocks */}
              {isPending && (
                <div className='-top-6 -translate-x-1/2 absolute left-1/2 z-10 transform rounded-t-md bg-yellow-500 px-2 py-0.5 text-white text-xs'>
                  Next Step
                </div>
              )}

              {!data.isPreview && (
                <ActionBar
                  blockId={id}
                  blockType={type}
                  workflowId={currentWorkflowId}
                  channelId={workflowChannelId}
                  disabled={!userPermissions.canEdit || isReadOnlyBlock}
                  showWebhookIndicator={showWebhookIndicator}
                  showScheduleBadge={shouldShowScheduleBadge}
                  hasScheduleInfo={hasScheduleInfo}
                  isScheduleDisabled={Boolean(scheduleInfo?.isDisabled)}
                  onScheduleToggle={onScheduleToggle}
                />
              )}
              {/* Connection Blocks - Don't show for trigger blocks or blocks in trigger mode */}
              {config.category !== 'triggers' &&
                !displayTriggerMode &&
                (!isReadOnlyBlock || data.isPreview) && (
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
                    horizontalHandles ? '!left-[-8px]' : '!top-[-8px]'
                  )}
                  style={{
                    ...(horizontalHandles
                      ? { top: '50%', transform: 'translateY(-50%)' }
                      : { left: '50%', transform: 'translateX(-50%)' }),
                  }}
                  data-nodeid={id}
                  data-handleid='target'
                  isConnectableStart={false}
                  isConnectableEnd={!isReadOnlyBlock && !isProtectedByLock}
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
                  if (!data.isPreview) {
                    e.stopPropagation()
                  }
                }}
              >
                <div className='flex min-w-0 flex-1 items-center gap-3'>
                  <div
                    className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
                    style={
                      isEnabled
                        ? getIconTileStyle(config.bgColor)
                        : { backgroundColor: 'gray', color: 'white' }
                    }
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
                  {isLocked && (
                    <Badge
                      variant='secondary'
                      className='bg-gray-100 text-gray-500 hover:bg-gray-100'
                    >
                      Locked
                    </Badge>
                  )}
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
                </div>
              </div>

              {/* Block Content - Only render if there are subblocks */}
              {shouldRenderInNodeSubBlocks && (
                <div
                  ref={contentRef}
                  className='cursor-pointer p-3 text-sm'
                  onMouseDown={(e) => {
                    if (!data.isPreview) {
                      e.stopPropagation()
                    }
                  }}
                >
                  <div className='flex flex-col gap-2'>
                    {type === 'condition'
                      ? conditionRows.map((conditionRow) => (
                        <div key={conditionRow.id} className='flex items-center gap-2'>
                          <p
                            className='min-w-0 truncate text-muted-foreground capitalize'
                            title={conditionRow.title}
                          >
                            {conditionRow.title}
                          </p>
                          <p
                            className='min-w-0 flex-1 truncate text-right'
                            title={conditionRow.value}
                          >
                            {formatSubBlockValue(conditionRow.value)}
                          </p>
                        </div>
                      ))
                      : flattenedSubBlocks.map((subBlock, index) => {
                        const stableKey = `${getSubBlockStableKey(subBlock, subBlockState)}-${index}`
                        const rawValue = resolveDisplayedSubBlockValue(
                          {
                            readOnly: subBlock.readOnly,
                            defaultValue: subBlock.defaultValue,
                          },
                          subBlockState[subBlock.id]?.value
                        )
                        const isJsonCodeSubBlock =
                          subBlock.type === 'code' && subBlock.language === 'json'
                        const jsonPreviewRows = isJsonCodeSubBlock
                          ? buildJsonPreviewFieldRows(rawValue)
                          : null
                        const displayValue = subBlock.password
                          ? rawValue === null || rawValue === undefined || rawValue === ''
                            ? '-'
                            : 'Configured'
                          : subBlock.type === 'skill-input'
                            ? formatSkillInputValue(rawValue)
                            : formatSubBlockValue(rawValue)

                        if (isJsonCodeSubBlock) {
                          const jsonTitle = subBlock.title ?? subBlock.id
                          return (
                            <div key={stableKey} className='flex flex-col gap-1'>
                              <p
                                className='min-w-0 truncate text-muted-foreground capitalize'
                                title={jsonTitle}
                              >
                                {jsonTitle}:
                              </p>
                              <div className='ml-3 overflow-hidden rounded-md border border-border bg-background'>
                                {(jsonPreviewRows ?? []).map((jsonRow, jsonRowIndex) => (
                                  <div
                                    key={`${stableKey}-json-row-${jsonRowIndex}`}
                                    className={cn(
                                      'flex items-center gap-2 px-3 py-1.5',
                                      jsonRowIndex > 0 && 'border-border border-t'
                                    )}
                                  >
                                    <p
                                      className='min-w-0 truncate text-muted-foreground'
                                      title={jsonRow.title}
                                    >
                                      {jsonRow.title}
                                    </p>
                                    <p
                                      className='min-w-0 flex-1 truncate text-right'
                                      title={jsonRow.value}
                                    >
                                      {jsonRow.value}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        }

                        return (
                          <div key={stableKey} className='flex items-center gap-2'>
                            <p
                              className='min-w-0 truncate text-muted-foreground capitalize'
                              title={subBlock.title ?? subBlock.id}
                            >
                              {subBlock.title ?? subBlock.id}
                            </p>
                            <p
                              className='min-w-0 flex-1 truncate text-right'
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
                          className='min-w-0 truncate text-muted-foreground capitalize'
                          title='error'
                        >
                          error
                        </p>
                        <p className='min-w-0 flex-1 truncate text-right' title='-'>
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
                        '!right-[-8px]'
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
              ) : (
                type !== 'response' && (
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
                        horizontalHandles ? '!right-[-8px]' : '!bottom-[-8px]'
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
                )
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
                        right: '-8px',
                        top: `${60 + conditionRows.length * 29}px`,
                        bottom: 'auto',
                        transform: 'translateY(-50%)',
                      }
                      : useHorizontalErrorHandle
                        ? {
                          right: '-8px',
                          top: 'auto',
                          bottom: '30px',
                          transform: 'translateY(0)',
                        }
                        : {
                          bottom: '-8px',
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
