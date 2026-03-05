import { memo, useMemo } from 'react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import type { PreviewNodeData } from './preview-payload-adapter'

function extractSubBlockValue(entry: unknown): unknown {
  if (entry && typeof entry === 'object' && 'value' in entry) {
    return (entry as { value: unknown }).value
  }
  return entry
}

function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value) && value.length === 0) {
    return '-'
  }

  if (typeof value === 'object') {
    try {
      const asJson = JSON.stringify(value)
      return asJson === '{}' ? '-' : asJson
    } catch {
      return String(value)
    }
  }

  return String(value)
}

export const PreviewNode = memo(function PreviewNode({ data }: NodeProps<PreviewNodeData>) {
  const blockConfig = useMemo(() => getBlock(data.type) ?? data.config, [data.type, data.config])
  const Icon = blockConfig.icon
  const isEnabled = data.blockState?.enabled ?? true
  const useHorizontalHandles = data.blockState?.horizontalHandles ?? false
  const isTriggerMode =
    Boolean(data.blockState?.triggerMode) ||
    blockConfig.category === 'triggers' ||
    data.type === 'starter'
  const previewStateRaw = data.subBlockValues ?? data.blockState?.subBlocks ?? {}
  const showInputHandle = blockConfig.category !== 'triggers'
  const showOutputHandles = data.type !== 'condition' && data.type !== 'response'
  const previewSubBlocks = useMemo(() => {
    const isPureTriggerBlock = blockConfig.category === 'triggers'
    return (blockConfig.subBlocks || []).filter((subBlock) => {
      if (subBlock.hidden || subBlock.hideFromPreview) return false

      if (isTriggerMode) {
        if (isPureTriggerBlock) {
          return subBlock.mode === 'trigger' || !subBlock.mode
        }
        return subBlock.mode === 'trigger'
      }

      return subBlock.mode !== 'trigger'
    })
  }, [blockConfig.category, blockConfig.subBlocks, isTriggerMode])

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-card shadow-xs',
        'w-[320px]',
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
          style={{
            backgroundColor:
              isEnabled && blockConfig.bgColor ? `${blockConfig.bgColor}20` : undefined,
            color: isEnabled ? blockConfig.bgColor || undefined : undefined,
          }}
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
          {previewSubBlocks.map((subBlock) => {
            const rawValue = extractSubBlockValue(previewStateRaw[subBlock.id])
            const displayValue = formatPreviewValue(rawValue)
            return (
              <div key={subBlock.id} className='flex items-center gap-2'>
                <p
                  className='min-w-0 truncate text-[11px] text-muted-foreground capitalize'
                  title={subBlock.title ?? subBlock.id}
                >
                  {subBlock.title ?? subBlock.id}
                </p>
                <p className='min-w-0 flex-1 truncate text-right text-[11px]' title={displayValue}>
                  {displayValue}
                </p>
              </div>
            )
          })}
          {showInputHandle && (
            <div className='flex items-center gap-2'>
              <p className='min-w-0 truncate text-[11px] text-muted-foreground capitalize'>error</p>
            </div>
          )}
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
