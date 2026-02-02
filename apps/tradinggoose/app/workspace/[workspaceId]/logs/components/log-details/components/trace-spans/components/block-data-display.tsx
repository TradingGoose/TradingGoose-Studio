import { useMemo } from 'react'
import { CopyButton } from '@/components/ui/copy-button'
import { transformBlockData } from '@/app/workspace/[workspaceId]/logs/components/log-details/components/trace-spans/utils'

export function BlockDataDisplay({
  data,
  blockType,
  isInput = false,
}: {
  data: unknown
  blockType?: string
  isInput?: boolean
}) {
  const transformedData = useMemo(
    () => transformBlockData(data, blockType || 'unknown', isInput),
    [data, blockType, isInput]
  )

  const jsonString = useMemo(() => {
    if (transformedData === undefined) return 'undefined'
    try {
      const stringified = JSON.stringify(transformedData, null, 2)
      return stringified ?? 'undefined'
    } catch (_error) {
      return String(transformedData)
    }
  }, [transformedData])

  return (
    <div className='group relative max-h-60 overflow-y-auto overflow-x-hidden rounded p-2'>
      <CopyButton text={jsonString} />
      <pre className='whitespace-pre-wrap break-all font-mono text-xs text-foreground'>
        {jsonString}
      </pre>
    </div>
  )
}
