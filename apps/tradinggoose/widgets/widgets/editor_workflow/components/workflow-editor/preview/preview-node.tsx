import { memo, useMemo } from 'react'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { getBlock } from '@/blocks'
import { SubBlockSummaryRows } from '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-summary-rows'
import { getPreviewDiffClasses } from './preview-diff'
import type { PreviewCanvasNode } from './preview-payload-adapter'

export const PreviewNode = memo(function PreviewNode({ id, data }: NodeProps<PreviewCanvasNode>) {
  const blockConfig = useMemo(() => getBlock(data.type) ?? data.config, [data.type, data.config])
  const Icon = blockConfig.icon
  const isEnabled = data.blockState?.enabled ?? true
  const isAdvancedMode = data.blockState?.advancedMode ?? false
  const useHorizontalHandles = data.blockState?.horizontalHandles ?? false
  const isPureTriggerBlock = blockConfig.category === 'triggers'
  const isTriggerMode = Boolean(data.blockState?.triggerMode) || isPureTriggerBlock
  const previewStateRaw = data.subBlockValues ?? data.blockState?.subBlocks ?? {}
  const showInputHandle = blockConfig.category !== 'triggers'
  const showOutputHandles = data.type !== 'condition' && data.type !== 'response'
  const previewSubBlocks = useMemo(() => {
    return buildSubBlockRows({
      blockId: id,
      subBlocks: blockConfig.subBlocks || [],
      stateToUse: previewStateRaw,
      isAdvancedMode,
      isTriggerMode,
      isPureTriggerBlock,
      availableTriggerIds: blockConfig.triggers?.available,
      hideFromPreview: true,
      triggerSubBlockOwner: 'all',
    }).flat()
  }, [
    blockConfig.subBlocks,
    blockConfig.triggers?.available,
    isAdvancedMode,
    isTriggerMode,
    isPureTriggerBlock,
    previewStateRaw,
  ])

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-card shadow-xs',
        'w-[320px]',
        getPreviewDiffClasses(data.diffStatus),
        !isEnabled && 'opacity-75'
      )}
    >
      {showInputHandle && (
        <Handle
          type='target'
          position={useHorizontalHandles ? Position.Left : Position.Top}
          id='target'
          isConnectable={false}
          className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
        />
      )}

      <div className='flex items-center gap-3 px-3 py-2'>
        <div
          className='flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary'
          style={isEnabled ? getIconTileStyle(blockConfig.bgColor) : undefined}
        >
          <Icon className='h-4 w-4' />
        </div>

        <div className='min-w-0'>
          <p className='truncate font-medium text-sm'>{data.name}</p>
          <p className='truncate text-[11px] text-muted-foreground'>{data.type}</p>
        </div>
      </div>

      {previewSubBlocks.length > 0 && (
        <div className='space-y-1 border-border border-t px-3 py-2'>
          <SubBlockSummaryRows
            blockId={id}
            subBlocks={previewSubBlocks}
            stateToUse={previewStateRaw}
            showErrorRow={showInputHandle}
            availableTriggerIds={blockConfig.triggers?.available}
            labelClassName='text-[11px]'
            valueClassName='text-[11px]'
          />
        </div>
      )}

      {showOutputHandles && (
        <>
          <Handle
            type='source'
            position={useHorizontalHandles ? Position.Right : Position.Bottom}
            id='source'
            isConnectable={false}
            className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
          />
          {blockConfig.category !== 'triggers' && (
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              isConnectable={false}
              className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
              style={{ top: '70%' }}
            />
          )}
        </>
      )}
    </div>
  )
})

PreviewNode.displayName = 'PreviewNode'
