import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from '@xyflow/react'
import { Check, ChevronDown, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { useBlock, useBlockProtection } from '@/lib/yjs/use-workflow-doc'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import { getBlock } from '@/blocks'
import { useWorkflowEditorActions } from '@/hooks/workflow/use-workflow-editor-actions'
import { buildTriggerEditingLayout } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/trigger-editing-layout'
import { SubBlockEditRows } from '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-edit-rows'
import { useWorkflowI18n } from '@/widgets/widgets/editor_workflow/copy'

interface NodeEditorPanelProps {
  selectedNodeId: string | null
}

const panelClassName =
  'allow-scroll !m-2 max-h-[calc(100%-1rem)] min-w-0 w-[calc(100%-1rem)] max-w-96 overflow-y-auto rounded-lg border bg-card shadow-md'

// React Flow's `.react-flow__panel` hard-codes `z-index: 5`; FloatingControls sits
// at `z-10` in the same stacking context. An inline style is the reliable way to
// lift the panel above it (beats the class rule, needs no Tailwind class generation).
const panelStyle = { zIndex: 20 }

export function NodeEditorPanel({ selectedNodeId }: NodeEditorPanelProps) {
  const { workflowEditorCopy, workflowInspectorCopy } = useWorkflowI18n()
  const canEdit = useOptionalWorkflowSession()?.canEdit === true
  const selectedBlock = useBlock(selectedNodeId ?? '')
  const isSelectedBlockProtected = useBlockProtection(selectedNodeId ?? '')

  const blockConfig = useMemo(
    () => (selectedBlock ? getBlock(selectedBlock.type) : undefined),
    [selectedBlock]
  )

  const shouldDisableWrite = !canEdit || isSelectedBlockProtected
  const { collaborativeToggleBlockAdvancedMode, collaborativeUpdateBlockName } =
    useWorkflowEditorActions()

  const [isRenaming, setIsRenaming] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [additionalFieldsVisibility, setAdditionalFieldsVisibility] = useState<
    Record<string, boolean>
  >({})
  const renamingBlockIdRef = useRef<string | null>(null)
  const nameInputRefCallback = useCallback((element: HTMLInputElement | null) => {
    if (element) {
      element.select()
    }
  }, [])

  const handleStartRename = useCallback(() => {
    if (!selectedBlock || shouldDisableWrite) return
    renamingBlockIdRef.current = selectedBlock.id
    setEditedName(selectedBlock.name)
    setIsRenaming(true)
  }, [selectedBlock, shouldDisableWrite])

  const handleSaveRename = useCallback(() => {
    const blockId = renamingBlockIdRef.current
    if (!blockId || !isRenaming || shouldDisableWrite) return

    const trimmedName = editedName.trim()
    const currentName = selectedBlock?.name ?? ''

    if (
      trimmedName &&
      trimmedName !== currentName &&
      !collaborativeUpdateBlockName(blockId, trimmedName)
    ) {
      return
    }

    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [collaborativeUpdateBlockName, editedName, isRenaming, selectedBlock, shouldDisableWrite])

  const handleCancelRename = useCallback(() => {
    renamingBlockIdRef.current = null
    setIsRenaming(false)
    setEditedName('')
  }, [])
  const stopPanelEvent = useCallback((event: { stopPropagation: () => void }) => {
    event.stopPropagation()
  }, [])
  useEffect(() => {
    if (!isRenaming) return
    if (!selectedBlock || renamingBlockIdRef.current !== selectedBlock.id) {
      handleCancelRename()
    }
  }, [handleCancelRename, isRenaming, selectedBlock])

  const selectedBlockDisplayName = selectedBlock ? selectedBlock.name : ''

  const layout = useMemo(() => {
    return buildTriggerEditingLayout({
      inspectorCopy: workflowInspectorCopy,
      blockType: selectedBlock?.type ?? '',
      blockId: selectedBlock?.id,
      blockConfig,
      blockState: selectedBlock,
      shouldDisableWrite,
    })
  }, [blockConfig, selectedBlock, shouldDisableWrite, workflowInspectorCopy])

  const {
    regularRows,
    additionalRows,
    stateToUse,
    hasAdditionalFields,
    isTriggerConfigurationView,
  } = layout
  const displayAdditionalFields =
    layout.hasAdvancedFields || shouldDisableWrite
      ? layout.displayAdditionalFields
      : (additionalFieldsVisibility[selectedBlock?.id ?? ''] ?? layout.displayAdditionalFields)

  const handleToggleAdditionalFields = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!selectedBlock || shouldDisableWrite) return
    if (layout.hasAdvancedFields) {
      collaborativeToggleBlockAdvancedMode(selectedBlock.id)
    } else {
      setAdditionalFieldsVisibility((visibility) => ({
        ...visibility,
        [selectedBlock.id]: !displayAdditionalFields,
      }))
    }
  }

  const emptyStateMessage = useMemo(() => {
    if (isTriggerConfigurationView) {
      return workflowEditorCopy.triggerNoEditableFields
    }

    return workflowEditorCopy.blockNoEditableFields
  }, [isTriggerConfigurationView, workflowEditorCopy])

  if (!selectedNodeId) return null

  if (!selectedBlock) {
    return (
      <Panel
        position='top-right'
        style={panelStyle}
        className={`${panelClassName} p-4`}
        onMouseDown={stopPanelEvent}
        onPointerDown={stopPanelEvent}
        onClick={stopPanelEvent}
        onWheel={stopPanelEvent}
        onTouchStart={stopPanelEvent}
      >
        <div className='text-sm'>{workflowEditorCopy.nodeNotFound}</div>
      </Panel>
    )
  }

  if (selectedBlock.type === 'note') return null

  if (!blockConfig) {
    return (
      <Panel
        position='top-right'
        style={panelStyle}
        className={`${panelClassName} p-4`}
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
      style={panelStyle}
      className={`${panelClassName} px-4 pb-4`}
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
                style={
                  isEnabled
                    ? getIconTileStyle(blockConfig.bgColor)
                    : { backgroundColor: 'gray', color: 'white' }
                }
              >
                {(() => {
                  const Icon = blockConfig.icon
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
                  className='min-w-0 flex-1 truncate bg-transparent pr-[8px] font-medium text-sm'
                />
              ) : (
                <h3
                  className='min-w-0 flex-1 cursor-pointer truncate pr-[8px] font-medium text-sm'
                  title={selectedBlockDisplayName}
                  onDoubleClick={handleStartRename}
                  onMouseDown={(e) => {
                    if (e.detail === 2) {
                      e.preventDefault()
                    }
                  }}
                >
                  {selectedBlockDisplayName}
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
        {regularRows.length === 0 && !hasAdditionalFields ? (
          <div className='rounded-md border border-dashed p-3 text-muted-foreground text-xs'>
            {emptyStateMessage}
          </div>
        ) : (
          <>
            <SubBlockEditRows
              blockId={selectedBlock.id}
              rows={regularRows}
              subBlockConfigs={blockConfig.subBlocks}
              isAdvancedMode={selectedBlock.advancedMode ?? false}
              stateToUse={stateToUse}
              disabled={shouldDisableWrite}
              rowKeyPrefix='panel-row'
              availableTriggerIds={blockConfig?.triggers?.available}
            />
            {hasAdditionalFields && (!shouldDisableWrite || displayAdditionalFields) && (
              <div className='flex items-center gap-[10px] pt-[4px]'>
                <div className='h-px flex-1 border-border border-t border-dashed' />
                {shouldDisableWrite ? (
                  <span className='whitespace-nowrap font-medium text-[13px] text-muted-foreground'>
                    {workflowEditorCopy.additionalFields}
                  </span>
                ) : (
                  <button
                    type='button'
                    aria-expanded={displayAdditionalFields}
                    onPointerDown={stopPanelEvent}
                    onMouseDown={stopPanelEvent}
                    onClick={handleToggleAdditionalFields}
                    className='flex items-center gap-[6px] whitespace-nowrap font-medium text-[13px] text-muted-foreground hover:text-foreground'
                  >
                    {displayAdditionalFields
                      ? workflowEditorCopy.hideAdditionalFields
                      : workflowEditorCopy.showAdditionalFields}
                    <ChevronDown
                      className={`h-[14px] w-[14px] transition-transform duration-200 ${displayAdditionalFields ? 'rotate-180' : ''}`}
                    />
                  </button>
                )}
                <div className='h-px flex-1 border-border border-t border-dashed' />
              </div>
            )}
            {displayAdditionalFields && (
              <SubBlockEditRows
                blockId={selectedBlock.id}
                rows={additionalRows}
                subBlockConfigs={blockConfig.subBlocks}
                isAdvancedMode={selectedBlock.advancedMode ?? false}
                stateToUse={stateToUse}
                disabled={shouldDisableWrite}
                rowKeyPrefix='panel-additional-row'
                availableTriggerIds={blockConfig.triggers?.available}
              />
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

export default NodeEditorPanel
