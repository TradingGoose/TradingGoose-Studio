import { useMemo } from 'react'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { getBlock } from '@/blocks'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { SubBlockSummaryRows } from '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-summary-rows'

interface ReadOnlyNodeEditorPanelProps {
  selectedNodeId: string | null
  workflowState: WorkflowState
}

export function ReadOnlyNodeEditorPanel({
  selectedNodeId,
  workflowState,
}: ReadOnlyNodeEditorPanelProps) {
  const selectedBlock = useMemo(() => {
    if (!selectedNodeId) {
      return null
    }

    return workflowState.blocks[selectedNodeId] ?? null
  }, [selectedNodeId, workflowState.blocks])

  if (!selectedNodeId) {
    return (
      <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
        <div className='flex h-full items-center justify-center text-center'>
          <p className='text-muted-foreground text-sm'>
            Select a block to view its preview details.
          </p>
        </div>
      </aside>
    )
  }

  if (!selectedBlock) {
    return (
      <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
        <div className='space-y-2'>
          <h3 className='font-medium text-sm'>Node not found</h3>
          <p className='text-muted-foreground text-xs'>The selected node is no longer available.</p>
        </div>
      </aside>
    )
  }

  const blockConfig = getBlock(selectedBlock.type)
  const previewSubBlocks = blockConfig
    ? buildSubBlockRows({
        subBlocks: blockConfig.subBlocks || [],
        stateToUse: selectedBlock.subBlocks || {},
        isAdvancedMode: selectedBlock.advancedMode ?? false,
        isTriggerMode:
          Boolean(selectedBlock.triggerMode) ||
          blockConfig.category === 'triggers' ||
          selectedBlock.type === 'starter',
        isPureTriggerBlock: blockConfig.category === 'triggers',
        availableTriggerIds: blockConfig.triggers?.available,
        hideFromPreview: true,
        triggerSubBlockOwner: 'all',
      }).flat()
    : []

  return (
    <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
      <div className='space-y-4'>
        <header className='space-y-1'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide'>Preview Inspector</p>
          <h3 className='line-clamp-2 font-medium text-sm'>{selectedBlock.name}</h3>
        </header>

        {previewSubBlocks.length > 0 ? (
          <div className='space-y-2'>
            <SubBlockSummaryRows
              blockId={selectedBlock.id}
              subBlocks={previewSubBlocks}
              stateToUse={selectedBlock.subBlocks || {}}
              availableTriggerIds={blockConfig?.triggers?.available}
            />
          </div>
        ) : (
          <p className='text-muted-foreground text-xs'>No values to display.</p>
        )}
      </div>
    </aside>
  )
}
