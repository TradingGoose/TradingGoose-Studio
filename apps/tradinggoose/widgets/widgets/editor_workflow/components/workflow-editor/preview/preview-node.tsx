import { memo, type ReactNode, useMemo } from 'react'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import { getIconTileStyle } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { buildSubBlockRows } from '@/lib/workflows/sub-block-rows'
import { getBlock } from '@/blocks'
import { resolveTriggerIdFromSubBlocks } from '@/triggers/resolution'
import {
  PrecomputedSubBlockSummaryRows,
  SubBlockSummaryRows,
} from '@/widgets/widgets/editor_workflow/components/workflow-render/sub-block-summary-rows'
import { useWorkflowI18n } from '@/widgets/widgets/editor_workflow/copy'
import { getPreviewDiffClasses } from './preview-diff'
import type { PreviewCanvasNode, PreviewNodeData } from './preview-payload-adapter'

function hasPrecomputedPreviewContent(data: PreviewNodeData) {
  return data.title !== undefined || data.summaryRows !== undefined
}

function PreviewNodeCard({
  data,
  blockConfig,
  title,
  isEnabled,
  useHorizontalHandles,
  summary,
}: {
  data: PreviewCanvasNode['data']
  blockConfig: NonNullable<ReturnType<typeof getBlock>> | NonNullable<PreviewNodeData['config']>
  title: string
  isEnabled: boolean
  useHorizontalHandles: boolean
  summary?: ReactNode
}) {
  const Icon = blockConfig.icon
  const showInputHandle = blockConfig.category !== 'triggers'
  const showOutputHandles = data.type !== 'condition' && data.type !== 'response'

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-card shadow-xs',
        'w-[320px]',
        getPreviewDiffClasses(data.diffStatus),
        !isEnabled && 'opacity-75'
      )}
    >
      {showInputHandle ? (
        <Handle
          type='target'
          position={useHorizontalHandles ? Position.Left : Position.Top}
          id='target'
          isConnectable={false}
          className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
        />
      ) : null}

      <div className='flex items-center gap-3 px-3 py-2'>
        <div
          className='flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary'
          style={isEnabled ? getIconTileStyle(blockConfig.bgColor) : undefined}
        >
          <Icon className='h-4 w-4' />
        </div>

        <div className='min-w-0'>
          <p className='truncate font-medium text-sm'>{title}</p>
          <p className='truncate text-[11px] text-muted-foreground'>{data.type}</p>
        </div>
      </div>

      {summary}

      {showOutputHandles ? (
        <>
          <Handle
            type='source'
            position={useHorizontalHandles ? Position.Right : Position.Bottom}
            id='source'
            isConnectable={false}
            className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
          />
          {blockConfig.category !== 'triggers' ? (
            <Handle
              type='source'
              position={Position.Right}
              id='error'
              isConnectable={false}
              className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
              style={{ top: '70%' }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function LocalizedPreviewNode({ id, data }: NodeProps<PreviewCanvasNode>) {
  const { getLocalizedDefaultBlockName, localizeWorkflowSubBlockConfig } = useWorkflowI18n()
  const blockConfig = useMemo(
    () => getBlock(data.type) ?? data.config ?? null,
    [data.type, data.config]
  )
  const previewStateRaw = data.subBlockValues ?? data.blockState?.subBlocks ?? {}
  const localizedBlockName = blockConfig
    ? getLocalizedDefaultBlockName(blockConfig.type, data.name)
    : data.name
  const triggerId = blockConfig
    ? resolveTriggerIdFromSubBlocks(previewStateRaw, blockConfig.triggers?.available)
    : null
  const localizedSubBlocks = useMemo(
    () =>
      blockConfig
        ? (blockConfig.subBlocks || []).map((subBlock) =>
            localizeWorkflowSubBlockConfig(subBlock, data.type, triggerId ?? undefined)
          )
        : [],
    [blockConfig, data.type, localizeWorkflowSubBlockConfig, triggerId]
  )
  const isEnabled = data.blockState?.enabled ?? true
  const isAdvancedMode = data.blockState?.advancedMode ?? false
  const useHorizontalHandles = data.blockState?.horizontalHandles ?? true
  const isPureTriggerBlock = blockConfig?.category === 'triggers'
  const isTriggerMode = Boolean(data.blockState?.triggerMode) || isPureTriggerBlock
  const previewSubBlocks = useMemo(
    () =>
      blockConfig
        ? buildSubBlockRows({
            blockId: id,
            subBlocks: localizedSubBlocks,
            stateToUse: previewStateRaw,
            isAdvancedMode,
            isTriggerMode,
            isPureTriggerBlock,
            availableTriggerIds: blockConfig.triggers?.available,
            hideFromPreview: true,
            triggerSubBlockOwner: 'all',
            includeBasicSubBlocksInAdvancedMode: true,
          }).flat()
        : [],
    [
      blockConfig?.triggers?.available,
      id,
      isAdvancedMode,
      isPureTriggerBlock,
      isTriggerMode,
      localizedSubBlocks,
      previewStateRaw,
    ]
  )

  if (!blockConfig) {
    return null
  }

  const summary =
    previewSubBlocks.length > 0 ? (
      <div className='space-y-1 border-border border-t px-3 py-2'>
        <SubBlockSummaryRows
          blockId={id}
          blockType={data.type}
          subBlocks={previewSubBlocks}
          stateToUse={previewStateRaw}
          showErrorRow={blockConfig.category !== 'triggers'}
          availableTriggerIds={blockConfig.triggers?.available}
          labelClassName='text-[11px]'
          valueClassName='text-[11px]'
        />
      </div>
    ) : null

  return (
    <PreviewNodeCard
      data={data}
      blockConfig={blockConfig}
      title={localizedBlockName}
      isEnabled={isEnabled}
      useHorizontalHandles={useHorizontalHandles}
      summary={summary}
    />
  )
}

function PrecomputedPreviewNode({ data }: NodeProps<PreviewCanvasNode>) {
  const blockConfig = getBlock(data.type) ?? data.config ?? null

  if (!blockConfig) {
    return null
  }

  const summaryRows = data.summaryRows ?? []
  const objectItemLabel = data.objectItemLabel

  if (summaryRows.length > 0 && !objectItemLabel) {
    throw new Error('Missing localized object item label for precomputed preview summary rows.')
  }

  const summary =
    summaryRows.length > 0 && objectItemLabel ? (
      <div className='space-y-1 border-border border-t px-3 py-2'>
        <PrecomputedSubBlockSummaryRows
          rows={summaryRows}
          objectItemLabel={objectItemLabel}
          labelClassName='text-[11px]'
          valueClassName='text-[11px]'
        />
      </div>
    ) : null

  return (
    <PreviewNodeCard
      data={data}
      blockConfig={blockConfig}
      title={data.title ?? data.name}
      isEnabled={data.enabled ?? data.blockState?.enabled ?? true}
      useHorizontalHandles={data.horizontalHandles ?? data.blockState?.horizontalHandles ?? false}
      summary={summary}
    />
  )
}

export const PreviewNode = memo(function PreviewNode(props: NodeProps<PreviewCanvasNode>) {
  return hasPrecomputedPreviewContent(props.data) ? (
    <PrecomputedPreviewNode {...props} />
  ) : (
    <LocalizedPreviewNode {...props} />
  )
})

PreviewNode.displayName = 'PreviewNode'
