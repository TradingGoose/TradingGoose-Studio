import { useMemo } from 'react'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { SubBlockSummaryRows } from '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-summary-rows'

interface ReadOnlyNodeEditorPanelProps {
  selectedNodeId: string | null
  workflowState: WorkflowState
}

const loopPreviewSubBlocks: SubBlockConfig[] = [
  { id: 'loopType', title: 'Loop Type', type: 'dropdown' },
  {
    id: 'iterations',
    title: 'Iterations',
    type: 'short-input',
    condition: { field: 'loopType', value: 'for' },
  },
  {
    id: 'collection',
    title: 'Collection',
    type: 'long-input',
    condition: { field: 'loopType', value: 'forEach' },
  },
  {
    id: 'whileCondition',
    title: 'Condition',
    type: 'long-input',
    condition: { field: 'loopType', value: ['while', 'doWhile'] },
  },
]

const parallelPreviewSubBlocks: SubBlockConfig[] = [
  { id: 'parallelType', title: 'Parallel Type', type: 'dropdown' },
  {
    id: 'count',
    title: 'Executions',
    type: 'short-input',
    condition: { field: 'parallelType', value: 'count' },
  },
  {
    id: 'distribution',
    title: 'Collection',
    type: 'long-input',
    condition: { field: 'parallelType', value: 'collection' },
  },
]

const toSubBlockState = (values: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(values).map(([id, value]) => [id, { id, type: 'short-input', value }])
  )

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
  const previewConfig = (() => {
    if (selectedBlock.type === 'loop') {
      const loop = workflowState.loops?.[selectedBlock.id]
      const loopType = loop?.loopType ?? selectedBlock.data?.loopType ?? 'for'
      return {
        availableTriggerIds: undefined,
        stateToUse: toSubBlockState({
          loopType,
          iterations: loop?.iterations ?? selectedBlock.data?.count ?? 5,
          collection: loop?.forEachItems ?? selectedBlock.data?.collection,
          whileCondition: loop?.whileCondition ?? selectedBlock.data?.whileCondition,
        }),
        subBlocks: loopPreviewSubBlocks,
      }
    }

    if (selectedBlock.type === 'parallel') {
      const parallel = workflowState.parallels?.[selectedBlock.id]
      const parallelType = parallel?.parallelType ?? selectedBlock.data?.parallelType ?? 'count'
      return {
        availableTriggerIds: undefined,
        stateToUse: toSubBlockState({
          parallelType,
          count: parallel?.count ?? selectedBlock.data?.count ?? 5,
          distribution: parallel?.distribution ?? selectedBlock.data?.collection,
        }),
        subBlocks: parallelPreviewSubBlocks,
      }
    }

    if (!blockConfig) {
      return {
        availableTriggerIds: undefined,
        stateToUse: {},
        subBlocks: [],
      }
    }

    return {
      availableTriggerIds: blockConfig.triggers?.available,
      stateToUse: selectedBlock.subBlocks || {},
      subBlocks: buildSubBlockRows({
        blockId: selectedBlock.id,
        subBlocks: blockConfig.subBlocks || [],
        stateToUse: selectedBlock.subBlocks || {},
        isAdvancedMode: selectedBlock.advancedMode ?? false,
        isTriggerMode: Boolean(selectedBlock.triggerMode) || blockConfig.category === 'triggers',
        isPureTriggerBlock: blockConfig.category === 'triggers',
        availableTriggerIds: blockConfig.triggers?.available,
        hideFromPreview: true,
        triggerSubBlockOwner: 'all',
      }).flat(),
    }
  })()

  return (
    <aside className='w-80 shrink-0 border-border border-l bg-background/95 p-4'>
      <div className='space-y-4'>
        <header className='space-y-1'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide'>Preview Inspector</p>
          <h3 className='line-clamp-2 font-medium text-sm'>{selectedBlock.name}</h3>
        </header>

        {previewConfig.subBlocks.length > 0 ? (
          <div className='space-y-2'>
            <SubBlockSummaryRows
              blockId={selectedBlock.id}
              subBlocks={previewConfig.subBlocks}
              stateToUse={previewConfig.stateToUse}
              availableTriggerIds={previewConfig.availableTriggerIds}
            />
          </div>
        ) : (
          <p className='text-muted-foreground text-xs'>No values to display.</p>
        )}
      </div>
    </aside>
  )
}
