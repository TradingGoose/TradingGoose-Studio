import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Pencil } from 'lucide-react'
import { Panel } from 'reactflow'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCurrentWorkflow } from '@/hooks/workflow'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import {
  DEFAULT_WORKFLOW_CHANNEL_ID,
  useWorkflowStore,
} from '@/stores/workflows/workflow/store-client'
import { isBlockProtected } from '@/stores/workflows/workflow/utils'
import { LoopTool } from '@/widgets/widgets/editor_workflow/components/subflows/loop/loop-config'
import { ParallelTool } from '@/widgets/widgets/editor_workflow/components/subflows/parallel/parallel-config'
import { SubBlock } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/sub-block'
import { buildSubBlockRows } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/sub-block-layout'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface NodeEditorPanelProps {
  selectedNodeId: string | null
}

type LoopType = 'for' | 'forEach' | 'while' | 'doWhile'
type ParallelType = 'count' | 'collection'
type SubflowNodeType = 'loop' | 'parallel'

const LOOP_TYPE_OPTIONS: Array<{ value: LoopType; label: string }> = [
  { value: 'for', label: 'For Loop' },
  { value: 'forEach', label: 'For Each' },
  { value: 'while', label: 'While Loop' },
  { value: 'doWhile', label: 'Do While Loop' },
]

const PARALLEL_TYPE_OPTIONS: Array<{ value: ParallelType; label: string }> = [
  { value: 'count', label: 'Parallel Count' },
  { value: 'collection', label: 'Parallel Each' },
]

function getSubBlockStableKey(
  blockId: string,
  subBlock: SubBlockConfig,
  stateToUse: Record<string, any>
) {
  if (subBlock.type === 'mcp-dynamic-args') {
    const serverValue = stateToUse.server?.value || 'no-server'
    const toolValue = stateToUse.tool?.value || 'no-tool'
    return `${blockId}-${subBlock.id}-${serverValue}-${toolValue}`
  }

  if (subBlock.type === 'mcp-tool-selector') {
    const serverValue = stateToUse.server?.value || 'no-server'
    return `${blockId}-${subBlock.id}-${serverValue}`
  }

  return `${blockId}-${subBlock.id}`
}

export function NodeEditorPanel({ selectedNodeId }: NodeEditorPanelProps) {
  const currentWorkflow = useCurrentWorkflow()
  const userPermissions = useUserPermissionsContext()
  const workflowRoute = useOptionalWorkflowRoute()
  const workflowChannelId = workflowRoute?.channelId ?? DEFAULT_WORKFLOW_CHANNEL_ID
  const routeWorkflowId = workflowRoute?.workflowId ?? null

  const activeWorkflowId = useWorkflowRegistry(
    useCallback((state) => state.getActiveWorkflowId(workflowChannelId), [workflowChannelId])
  )
  const resolvedWorkflowId = activeWorkflowId ?? routeWorkflowId

  const storeBlockState = useWorkflowStore(
    useCallback(
      (state) => {
        const workflowBlock = selectedNodeId ? state.blocks[selectedNodeId] : undefined
        return {
          advancedMode: workflowBlock?.advancedMode ?? false,
          triggerMode: workflowBlock?.triggerMode ?? false,
          blocks: state.blocks,
        }
      },
      [selectedNodeId]
    )
  )

  const selectedSubflowState = useWorkflowStore(
    useCallback(
      (state) => {
        if (!selectedNodeId) {
          return {
            blockData: undefined,
            loop: undefined,
            parallel: undefined,
          }
        }

        const block = state.blocks[selectedNodeId]
        return {
          blockData: block?.data,
          loop: block ? state.loops[block.id] : undefined,
          parallel: block ? state.parallels[block.id] : undefined,
        }
      },
      [selectedNodeId]
    )
  )

  const selectedBlock = useMemo(() => {
    if (!selectedNodeId) {
      return null
    }

    return currentWorkflow.getBlockById(selectedNodeId)
  }, [currentWorkflow, selectedNodeId])

  useSubBlockStore(
    useCallback(
      (state) => {
        if (!resolvedWorkflowId || !selectedNodeId) return {}
        return state.workflowValues[resolvedWorkflowId]?.[selectedNodeId] || {}
      },
      [resolvedWorkflowId, selectedNodeId]
    )
  )

  const blockConfig = useMemo(
    () => (selectedBlock ? getBlock(selectedBlock.type) : undefined),
    [selectedBlock]
  )

  const isSelectedBlockProtected = useMemo(() => {
    if (!selectedNodeId) return false
    return isBlockProtected(selectedNodeId, storeBlockState.blocks)
  }, [selectedNodeId, storeBlockState.blocks])

  const isSubflow = selectedBlock?.type === 'loop' || selectedBlock?.type === 'parallel'
  const subflowConfig = useMemo(() => {
    if (!selectedBlock) return null
    if (selectedBlock.type === 'loop') return LoopTool
    if (selectedBlock.type === 'parallel') return ParallelTool
    return null
  }, [selectedBlock])

  const shouldDisableWrite =
    !userPermissions.canEdit || currentWorkflow.isDiffMode || isSelectedBlockProtected
  const {
    collaborativeToggleBlockAdvancedMode,
    collaborativeUpdateBlockName,
    collaborativeUpdateIterationCollection,
    collaborativeUpdateIterationCount,
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,
  } = useCollaborativeWorkflow()

  const [tempIterationValue, setTempIterationValue] = useState<string | null>(null)

  const [isRenaming, setIsRenaming] = useState(false)
  const [editedName, setEditedName] = useState('')
  const renamingBlockIdRef = useRef<string | null>(null)
  const nameInputRefCallback = useCallback((element: HTMLInputElement | null) => {
    if (element) {
      element.select()
    }
  }, [])

  const handleStartRename = useCallback(() => {
    if (!selectedBlock || shouldDisableWrite) return
    renamingBlockIdRef.current = selectedBlock.id
    setEditedName(selectedBlock.name || '')
    setIsRenaming(true)
  }, [selectedBlock, shouldDisableWrite])

  const handleSaveRename = useCallback(() => {
    const blockId = renamingBlockIdRef.current
    if (!blockId || !isRenaming) return

    const trimmedName = editedName.trim()
    if (trimmedName) {
      collaborativeUpdateBlockName(blockId, trimmedName)
    }

    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [collaborativeUpdateBlockName, editedName, isRenaming])

  const handleCancelRename = useCallback(() => {
    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [])
  const stopPanelEvent = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }, [])
  const handleToggleAdvancedFields = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (!selectedBlock) return
      collaborativeToggleBlockAdvancedMode(selectedBlock.id)
    },
    [collaborativeToggleBlockAdvancedMode, selectedBlock]
  )

  useEffect(() => {
    if (!isRenaming) return
    if (!selectedBlock || renamingBlockIdRef.current !== selectedBlock.id) {
      handleCancelRename()
    }
  }, [handleCancelRename, isRenaming, selectedBlock])

  const subflowCurrentType = useMemo(() => {
    if (!selectedBlock || !isSubflow) return null

    if (selectedBlock.type === 'loop') {
      return (
        (selectedSubflowState.loop?.loopType as LoopType | undefined) ||
        (selectedSubflowState.blockData?.loopType as LoopType | undefined) ||
        'for'
      )
    }

    return (
      (selectedSubflowState.parallel?.parallelType as ParallelType | undefined) ||
      (selectedSubflowState.blockData?.parallelType as ParallelType | undefined) ||
      'count'
    )
  }, [
    isSubflow,
    selectedBlock,
    selectedSubflowState.blockData,
    selectedSubflowState.loop?.loopType,
    selectedSubflowState.parallel?.parallelType,
  ])

  const isSubflowCountMode =
    (selectedBlock?.type === 'loop' && subflowCurrentType === 'for') ||
    (selectedBlock?.type === 'parallel' && subflowCurrentType === 'count')
  const isSubflowConditionMode =
    selectedBlock?.type === 'loop' &&
    (subflowCurrentType === 'while' || subflowCurrentType === 'doWhile')

  const subflowIterations = useMemo(() => {
    if (!selectedBlock || !isSubflow) return 5

    if (selectedBlock.type === 'loop') {
      return selectedSubflowState.loop?.iterations ?? selectedSubflowState.blockData?.count ?? 5
    }

    return selectedSubflowState.parallel?.count ?? selectedSubflowState.blockData?.count ?? 5
  }, [
    isSubflow,
    selectedBlock,
    selectedSubflowState.blockData?.count,
    selectedSubflowState.loop?.iterations,
    selectedSubflowState.parallel?.count,
  ])

  const subflowEditorValue = useMemo(() => {
    if (!selectedBlock || !isSubflow || !subflowCurrentType) return ''

    if (selectedBlock.type === 'loop') {
      const rawValue = isSubflowConditionMode
        ? (selectedSubflowState.loop?.whileCondition ??
          selectedSubflowState.blockData?.whileCondition)
        : (selectedSubflowState.loop?.forEachItems ?? selectedSubflowState.blockData?.collection)

      if (typeof rawValue === 'string') return rawValue
      if (rawValue === null || rawValue === undefined) return ''
      try {
        return JSON.stringify(rawValue)
      } catch {
        return String(rawValue)
      }
    }

    const rawValue =
      selectedSubflowState.parallel?.distribution ?? selectedSubflowState.blockData?.collection
    if (typeof rawValue === 'string') return rawValue
    if (rawValue === null || rawValue === undefined) return ''
    try {
      return JSON.stringify(rawValue)
    } catch {
      return String(rawValue)
    }
  }, [
    isSubflow,
    isSubflowConditionMode,
    selectedBlock,
    selectedSubflowState.blockData?.collection,
    selectedSubflowState.blockData?.whileCondition,
    selectedSubflowState.loop?.forEachItems,
    selectedSubflowState.loop?.whileCondition,
    selectedSubflowState.parallel?.distribution,
    subflowCurrentType,
  ])

  const subflowIterationInputValue = tempIterationValue ?? String(subflowIterations)
  const subflowMaxIterations = selectedBlock?.type === 'loop' ? 100 : 20

  const handleSubflowTypeChange = useCallback(
    (newType: string) => {
      if (!selectedBlock || !isSubflow || shouldDisableWrite) return

      if (
        selectedBlock.type === 'loop' &&
        (newType === 'for' || newType === 'forEach' || newType === 'while' || newType === 'doWhile')
      ) {
        collaborativeUpdateLoopType(selectedBlock.id, newType)
        return
      }

      if (selectedBlock.type === 'parallel' && (newType === 'count' || newType === 'collection')) {
        collaborativeUpdateParallelType(selectedBlock.id, newType)
      }
    },
    [
      collaborativeUpdateLoopType,
      collaborativeUpdateParallelType,
      isSubflow,
      selectedBlock,
      shouldDisableWrite,
    ]
  )

  const handleSubflowIterationsChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (shouldDisableWrite) return
      const sanitizedValue = event.target.value.replace(/[^0-9]/g, '')
      if (sanitizedValue.length === 0) {
        setTempIterationValue('')
        return
      }

      const parsedValue = Number.parseInt(sanitizedValue, 10)
      if (Number.isNaN(parsedValue)) {
        setTempIterationValue(sanitizedValue)
        return
      }

      setTempIterationValue(String(Math.min(subflowMaxIterations, parsedValue)))
    },
    [shouldDisableWrite, subflowMaxIterations]
  )

  const handleSubflowIterationsSave = useCallback(() => {
    if (!selectedBlock || !isSubflow || shouldDisableWrite) return

    const parsedValue = Number.parseInt(subflowIterationInputValue, 10)
    if (!Number.isNaN(parsedValue)) {
      const clampedValue = Math.max(1, Math.min(subflowMaxIterations, parsedValue))
      collaborativeUpdateIterationCount(
        selectedBlock.id,
        selectedBlock.type as SubflowNodeType,
        clampedValue
      )
    }

    setTempIterationValue(null)
  }, [
    collaborativeUpdateIterationCount,
    isSubflow,
    selectedBlock,
    shouldDisableWrite,
    subflowIterationInputValue,
    subflowMaxIterations,
  ])

  const handleSubflowEditorChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!selectedBlock || !isSubflow || shouldDisableWrite) return

      collaborativeUpdateIterationCollection(
        selectedBlock.id,
        selectedBlock.type as SubflowNodeType,
        event.target.value
      )
    },
    [collaborativeUpdateIterationCollection, isSubflow, selectedBlock, shouldDisableWrite]
  )

  useEffect(() => {
    setTempIterationValue(null)
  }, [selectedBlock?.id, subflowCurrentType])

  const {
    regularRows,
    advancedRows,
    stateToUse,
    displayAdvancedOptions,
    hasAdvancedOnlyFields,
    isTriggerConfigurationView,
  } = useMemo(() => {
    if (!selectedBlock || !blockConfig?.subBlocks) {
      return {
        regularRows: [] as SubBlockConfig[][],
        advancedRows: [] as SubBlockConfig[][],
        stateToUse: {},
        displayAdvancedOptions: false,
        hasAdvancedOnlyFields: false,
        isTriggerConfigurationView: false,
      }
    }

    let blockStateForConditions: Record<string, any> = {}
    const blockFromCurrentWorkflow = currentWorkflow.getBlockById(selectedBlock.id)

    if (currentWorkflow.isDiffMode && blockFromCurrentWorkflow) {
      blockStateForConditions = blockFromCurrentWorkflow.subBlocks || {}
    } else {
      const mergedBlock = resolvedWorkflowId
        ? mergeSubblockState(storeBlockState.blocks, resolvedWorkflowId, selectedBlock.id)[
            selectedBlock.id
          ]
        : storeBlockState.blocks[selectedBlock.id]
      blockStateForConditions = mergedBlock?.subBlocks || selectedBlock.subBlocks || {}
    }

    const isPureTriggerBlock = blockConfig.category === 'triggers'
    const effectiveTrigger =
      (currentWorkflow.isDiffMode
        ? Boolean(blockFromCurrentWorkflow?.triggerMode)
        : storeBlockState.triggerMode) || isPureTriggerBlock
    const effectiveAdvanced = currentWorkflow.isDiffMode
      ? Boolean(blockFromCurrentWorkflow?.advancedMode)
      : storeBlockState.advancedMode
    const advancedValuesPresent = blockConfig.subBlocks.some((subBlock) => {
      if (subBlock.mode !== 'advanced') return false
      const value = blockStateForConditions[subBlock.id]?.value
      if (value === undefined || value === null) return false
      if (typeof value === 'string') return value.trim().length > 0
      if (Array.isArray(value)) return value.length > 0
      if (typeof value === 'object') return Object.keys(value).length > 0
      return true
    })
    const advancedVisibility = shouldDisableWrite
      ? effectiveAdvanced || advancedValuesPresent
      : effectiveAdvanced
    const advancedOnlySubBlocks = blockConfig.subBlocks.filter(
      (subBlock) => subBlock.mode === 'advanced'
    )

    const regularRowsAccumulator = buildSubBlockRows({
      subBlocks: blockConfig.subBlocks,
      stateToUse: blockStateForConditions,
      isAdvancedMode: false,
      isTriggerMode: effectiveTrigger,
      isPureTriggerBlock,
      availableTriggerIds: blockConfig.triggers?.available,
      hideFromPreview: false,
    })
    const advancedRowsAccumulator = buildSubBlockRows({
      subBlocks: advancedOnlySubBlocks,
      stateToUse: blockStateForConditions,
      isAdvancedMode: true,
      isTriggerMode: effectiveTrigger,
      isPureTriggerBlock,
      availableTriggerIds: blockConfig.triggers?.available,
      hideFromPreview: false,
    })

    return {
      regularRows: regularRowsAccumulator,
      advancedRows: advancedRowsAccumulator,
      stateToUse: blockStateForConditions,
      displayAdvancedOptions: advancedVisibility,
      hasAdvancedOnlyFields: advancedRowsAccumulator.length > 0,
      isTriggerConfigurationView: effectiveTrigger,
    }
  }, [
    resolvedWorkflowId,
    blockConfig,
    currentWorkflow,
    selectedBlock,
    shouldDisableWrite,
    storeBlockState.advancedMode,
    storeBlockState.blocks,
    storeBlockState.triggerMode,
  ])

  const emptyStateMessage = useMemo(() => {
    if (isTriggerConfigurationView) {
      return 'This trigger has no editable fields in the panel.'
    }

    return 'No editable fields for this block.'
  }, [isTriggerConfigurationView])

  if (!selectedNodeId) return null

  if (!selectedBlock) {
    return null
  }

  if (selectedBlock.type === 'note') return null

  if (!blockConfig && !isSubflow) {
    return (
      <Panel
        position='top-right'
        className='allow-scroll max-h-[calc(100%-1rem)] w-96 overflow-y-auto rounded-lg border bg-card p-4 shadow-md'
        onMouseDown={stopPanelEvent}
        onPointerDown={stopPanelEvent}
        onClick={stopPanelEvent}
        onWheel={stopPanelEvent}
        onTouchStart={stopPanelEvent}
      >
        <div className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
          Missing block configuration for `{selectedBlock.type}`.
        </div>
      </Panel>
    )
  }

  const isEnabled = selectedBlock.enabled ?? true

  return (
    <Panel
      position='top-right'
      className='allow-scroll max-h-[calc(100%-1rem)] w-96 overflow-y-auto rounded-lg border bg-card px-4 pb-4 shadow-md'
      onMouseDown={stopPanelEvent}
      onPointerDown={stopPanelEvent}
      onClick={stopPanelEvent}
      onWheel={stopPanelEvent}
      onTouchStart={stopPanelEvent}
    >
      <div className='-mx-4 sticky top-0 z-40 w-[calc(100%+2rem)] border-border border-b bg-background'>
        <div className='p-4'>
          <div className='flex min-w-0 items-center justify-between '>
            <div className='flex min-w-0 flex-1 items-center gap-2'>
              <div
                className='relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-secondary text-foreground'
                style={{
                  backgroundColor: isEnabled
                    ? (isSubflow ? subflowConfig?.bgColor : blockConfig?.bgColor)
                      ? `${(isSubflow ? subflowConfig?.bgColor : blockConfig?.bgColor) || ''}20`
                      : undefined
                    : 'gray',
                  color: isEnabled
                    ? (isSubflow ? subflowConfig?.bgColor : blockConfig?.bgColor) || undefined
                    : 'white',
                }}
              >
                {(() => {
                  const Icon = isSubflow ? subflowConfig?.icon : blockConfig?.icon
                  return Icon ? <Icon className='h-5 w-5' /> : null
                })()}
              </div>
              {isRenaming ? (
                <input
                  ref={nameInputRefCallback}
                  type='text'
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onBlur={handleSaveRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveRename()
                    } else if (e.key === 'Escape') {
                      handleCancelRename()
                    }
                  }}
                  className='min-w-0 flex-1 truncate bg-transparent pr-[8px] font-medium text-sm outline-none'
                />
              ) : (
                <h3
                  className='min-w-0 flex-1 cursor-pointer truncate pr-[8px] font-medium text-sm'
                  title={selectedBlock.name}
                  onDoubleClick={handleStartRename}
                  onMouseDown={(e) => {
                    if (e.detail === 2) {
                      e.preventDefault()
                    }
                  }}
                >
                  {selectedBlock.name}
                </h3>
              )}
            </div>
            <Button
              variant='ghost'
              size='icon'
              className='h-6 w-6 bg-transparent'
              onClick={isRenaming ? handleSaveRename : handleStartRename}
              disabled={shouldDisableWrite}
              aria-label={isRenaming ? 'Save name' : 'Rename node'}
            >
              {isRenaming ? (
                <Check className='h-[14px] w-[14px]' />
              ) : (
                <Pencil className='h-[14px] w-[14px]' />
              )}
            </Button>
          </div>
        </div>
      </div>
      <div className='mt-3 space-y-4'>
        {isSubflow ? (
          <div className='space-y-4'>
            <div className='space-y-1'>
              <Label className='font-medium text-muted-foreground text-xs'>
                {selectedBlock.type === 'loop' ? 'Loop Type' : 'Parallel Type'}
              </Label>
              <Select
                value={subflowCurrentType || undefined}
                onValueChange={handleSubflowTypeChange}
                disabled={shouldDisableWrite}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Select type' />
                </SelectTrigger>
                <SelectContent>
                  {(selectedBlock.type === 'loop' ? LOOP_TYPE_OPTIONS : PARALLEL_TYPE_OPTIONS).map(
                    (option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>

            {isSubflowCountMode ? (
              <div className='space-y-1'>
                <Label className='font-medium text-muted-foreground text-xs'>
                  {selectedBlock.type === 'loop' ? 'Loop Iterations' : 'Parallel Executions'}
                </Label>
                <Input
                  type='text'
                  inputMode='numeric'
                  value={subflowIterationInputValue}
                  onChange={handleSubflowIterationsChange}
                  onBlur={handleSubflowIterationsSave}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      handleSubflowIterationsSave()
                    }
                  }}
                  disabled={shouldDisableWrite}
                  placeholder='5'
                />
                <p className='text-[11px] text-muted-foreground'>
                  Enter a value between 1 and {subflowMaxIterations}
                </p>
              </div>
            ) : (
              <div className='space-y-1'>
                <Label className='font-medium text-muted-foreground text-xs'>
                  {isSubflowConditionMode
                    ? 'While Condition'
                    : selectedBlock.type === 'loop'
                      ? 'Collection Items'
                      : 'Parallel Items'}
                </Label>
                <Textarea
                  value={subflowEditorValue}
                  onChange={handleSubflowEditorChange}
                  disabled={shouldDisableWrite}
                  rows={6}
                  placeholder={
                    isSubflowConditionMode ? '<counter.value> < 10' : "['item1', 'item2', 'item3']"
                  }
                  className='resize-y font-mono text-xs'
                />
              </div>
            )}
          </div>
        ) : regularRows.length === 0 && (!displayAdvancedOptions || advancedRows.length === 0) ? (
          <div className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
            {emptyStateMessage}
          </div>
        ) : (
          <>
            {regularRows.map((row, rowIndex) => (
              <div key={`panel-row-${rowIndex}`} className='flex gap-3'>
                {row.map((subBlock) => {
                  const stableKey = getSubBlockStableKey(selectedBlock.id, subBlock, stateToUse)
                  return (
                    <div
                      key={stableKey}
                      className={
                        subBlock.layout === 'half' ? 'flex-1 space-y-1' : 'w-full space-y-1'
                      }
                    >
                      <SubBlock
                        blockId={selectedBlock.id}
                        config={subBlock}
                        isConnecting={false}
                        disabled={shouldDisableWrite}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
            {hasAdvancedOnlyFields && !shouldDisableWrite && (
              <div className='flex items-center gap-[10px] pt-[4px]'>
                <div className='h-px flex-1 border-border border-t border-dashed' />
                <button
                  type='button'
                  onPointerDown={stopPanelEvent}
                  onMouseDown={stopPanelEvent}
                  onClick={handleToggleAdvancedFields}
                  className='flex items-center gap-[6px] whitespace-nowrap font-medium text-[13px] text-muted-foreground hover:text-foreground'
                >
                  {displayAdvancedOptions ? 'Hide additional fields' : 'Show additional fields'}
                  <ChevronDown
                    className={`h-[14px] w-[14px] transition-transform duration-200 ${displayAdvancedOptions ? 'rotate-180' : ''}`}
                  />
                </button>
                <div className='h-px flex-1 border-border border-t border-dashed' />
              </div>
            )}
            {hasAdvancedOnlyFields && shouldDisableWrite && displayAdvancedOptions && (
              <div className='flex items-center gap-[10px] pt-[4px]'>
                <div className='h-px flex-1 border-border border-t border-dashed' />
                <span className='whitespace-nowrap font-medium text-[13px] text-muted-foreground'>
                  Additional fields
                </span>
                <div className='h-px flex-1 border-border border-t border-dashed' />
              </div>
            )}
            {displayAdvancedOptions &&
              advancedRows.map((row, rowIndex) => (
                <div key={`panel-advanced-row-${rowIndex}`} className='flex gap-3'>
                  {row.map((subBlock) => {
                    const stableKey = getSubBlockStableKey(selectedBlock.id, subBlock, stateToUse)
                    return (
                      <div
                        key={stableKey}
                        className={
                          subBlock.layout === 'half' ? 'flex-1 space-y-1' : 'w-full space-y-1'
                        }
                      >
                        <SubBlock
                          blockId={selectedBlock.id}
                          config={subBlock}
                          isConnecting={false}
                          disabled={shouldDisableWrite}
                        />
                      </div>
                    )
                  })}
                </div>
              ))}
          </>
        )}
      </div>
    </Panel>
  )
}

export default NodeEditorPanel
