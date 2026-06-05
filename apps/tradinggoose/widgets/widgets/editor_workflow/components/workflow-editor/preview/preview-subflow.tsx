import { memo } from 'react'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import { cn } from '@/lib/utils'
import { getSubflowBlockConfig } from '@/widgets/widgets/editor_workflow/components/subflows/config'
import { useWorkflowI18n } from '@/widgets/widgets/editor_workflow/copy'
import { getPreviewDiffClasses } from './preview-diff'
import type { PreviewCanvasSubflowNode, PreviewSubflowData } from './preview-payload-adapter'

function hasPrecomputedPreviewContent(data: PreviewSubflowData) {
  return data.title !== undefined || data.startLabel !== undefined || data.endLabel !== undefined
}

function PreviewSubflowCard({
  data,
  title,
  startLabel,
  endLabel,
}: {
  data: PreviewCanvasSubflowNode['data']
  title: string
  startLabel: string
  endLabel: string
}) {
  const { width, height, enabled, kind } = data
  const isLoop = kind === 'loop'
  const subflowConfig = getSubflowBlockConfig(kind)
  const BlockIcon = subflowConfig.icon
  const startHandleId = isLoop ? 'loop-start-source' : 'parallel-start-source'
  const endHandleId = isLoop ? 'loop-end-source' : 'parallel-end-source'
  const endTargetHandleId = isLoop ? 'loop-end-target' : 'parallel-end-target'

  return (
    <div
      className={cn(
        'relative rounded-md border border-border bg-card',
        getPreviewDiffClasses(data.diffStatus)
      )}
      style={{ width, height }}
    >
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
            style={{ backgroundColor: enabled ? subflowConfig.bgColor : '#9CA3AF' }}
          >
            <BlockIcon className='h-4 w-4 text-white' />
          </div>
          <span
            className={cn('truncate font-medium text-sm', !enabled && 'text-muted-foreground')}
            title={title}
          >
            {title}
          </span>
        </div>
      </div>

      <div className='relative h-[calc(100%-41px)] p-4' />

      <div className='-translate-y-1/2 absolute top-1/2 left-4 inline-flex items-center rounded-md border border-border bg-background px-3 py-1 text-xs'>
        {startLabel}
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
        {endLabel}
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

function LocalizedPreviewSubflow({ data }: NodeProps<PreviewCanvasSubflowNode>) {
  const { workflowEditorCopy: copy, getLocalizedDefaultBlockName } = useWorkflowI18n()

  return (
    <PreviewSubflowCard
      data={data}
      title={getLocalizedDefaultBlockName(data.kind, data.name)}
      startLabel={copy.start}
      endLabel={copy.end}
    />
  )
}

function PrecomputedPreviewSubflow({ data }: NodeProps<PreviewCanvasSubflowNode>) {
  return (
    <PreviewSubflowCard
      data={data}
      title={data.title ?? data.name}
      startLabel={data.startLabel ?? 'Start'}
      endLabel={data.endLabel ?? 'End'}
    />
  )
}

export const PreviewSubflow = memo(function PreviewSubflow(props: NodeProps<PreviewCanvasSubflowNode>) {
  return hasPrecomputedPreviewContent(props.data) ? (
    <PrecomputedPreviewSubflow {...props} />
  ) : (
    <LocalizedPreviewSubflow {...props} />
  )
})

PreviewSubflow.displayName = 'PreviewSubflow'
