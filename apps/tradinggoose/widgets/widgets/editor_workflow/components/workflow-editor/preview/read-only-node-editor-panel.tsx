import { useMemo } from 'react'
import { useLocale } from 'next-intl'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'
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
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.widgets.workflowEditor
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
            {copy.selectBlockToViewPreviewDetails}
          </p>
        </div>
      </aside>
    )
  }

  if (!selectedBlock) {
    return (
      <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
        <div className='space-y-2'>
          <h3 className='font-medium text-sm'>{copy.nodeNotFound}</h3>
          <p className='text-muted-foreground text-xs'>{copy.selectedNodeUnavailable}</p>
        </div>
      </aside>
    )
  }

  const PanelComponent = resolveReadOnlyPreviewPanel(selectedBlock.type)

  return (
    <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
      <div className='space-y-4'>
        <header className='space-y-1'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide'>
            {copy.previewInspector}
          </p>
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
