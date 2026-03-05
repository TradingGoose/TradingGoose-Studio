import { useMemo } from 'react'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { resolveReadOnlyPreviewPanel } from './preview-panel-registry'

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
          <p className='text-muted-foreground text-sm'>Select a block to view its preview details.</p>
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

  const PanelComponent = resolveReadOnlyPreviewPanel(selectedBlock.type)

  return (
    <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
      <div className='space-y-4'>
        <header className='space-y-1'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide'>Preview Inspector</p>
          <h3 className='line-clamp-2 font-medium text-sm'>{selectedBlock.name}</h3>
        </header>

        <PanelComponent
          block={selectedBlock}
          readOnly={true}
        />
      </div>
    </aside>
  )
}
