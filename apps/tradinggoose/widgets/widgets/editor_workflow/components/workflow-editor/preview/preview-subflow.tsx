import { memo } from 'react'
import { RepeatIcon, SplitIcon } from 'lucide-react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { cn } from '@/lib/utils'
import type { PreviewSubflowData } from './preview-payload-adapter'

function PreviewSubflowInner({ data }: NodeProps<PreviewSubflowData>) {
  const { name, width, height, enabled, kind } = data

  const isLoop = kind === 'loop'
  const BlockIcon = isLoop ? RepeatIcon : SplitIcon
  const iconBackground = isLoop ? '#2FB3FF' : '#FEE12B'
  const blockName = name || (isLoop ? 'Loop' : 'Parallel')

  const startHandleId = isLoop ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = isLoop ? 'loop-end-source' : 'parallel-end-source'
  const endTargetHandleId = isLoop ? 'loop-end-target' : 'parallel-end-target'

  return (
    <div className='relative rounded-md border border-border bg-card' style={{ width, height }}>
      <Handle
        type='target'
        position={Position.Left}
        id='target'
        isConnectable={false}
        className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
        style={{ left: -8 }}
      />

      <div className='flex items-center justify-between rounded-t-[8px] border-border border-b bg-muted/40 px-3 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <div
            className='flex h-6 w-6 shrink-0 items-center justify-center rounded-md'
            style={{ backgroundColor: enabled ? iconBackground : '#9CA3AF' }}
          >
            <BlockIcon className='h-4 w-4 text-white' />
          </div>
          <span
            className={cn('truncate font-medium text-sm', !enabled && 'text-muted-foreground')}
            title={blockName}
          >
            {blockName}
          </span>
        </div>
      </div>

      <div className='relative h-[calc(100%-41px)] p-4' />

      <div className='-translate-y-1/2 absolute top-1/2 left-4 inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs'>
        Start
        <Handle
          type='source'
          position={Position.Right}
          id={startHandleId}
          isConnectable={false}
          className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
          style={{ right: -8, top: '50%', transform: 'translateY(-50%)' }}
        />
      </div>

      <div className='-translate-y-1/2 absolute top-1/2 right-4 inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs'>
        <Handle
          type='target'
          position={Position.Left}
          id={endTargetHandleId}
          isConnectable={false}
          className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
          style={{ left: -8, top: '50%', transform: 'translateY(-50%)' }}
        />
        End
      </div>
      <Handle
        type='source'
        position={Position.Right}
        id={endHandleId}
        isConnectable={false}
        className='!h-2 !w-2 !border-none !bg-transparent !opacity-0'
        style={{ right: -8, top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  )
}

export const PreviewSubflow = memo(PreviewSubflowInner)

PreviewSubflow.displayName = 'PreviewSubflow'
