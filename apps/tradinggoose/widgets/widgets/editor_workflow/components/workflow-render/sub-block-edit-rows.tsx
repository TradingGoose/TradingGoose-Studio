import { getTriggerAwareSubBlockStableKey } from '@/lib/workflows/sub-block-keys'
import type { SubBlockConfig } from '@/blocks/types'
import { SubBlock } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/sub-block'

interface SubBlockEditRowsProps {
  blockId: string
  rows: SubBlockConfig[][]
  stateToUse: Record<string, any>
  disabled: boolean
  rowKeyPrefix: string
  isConnecting?: boolean
  availableTriggerIds?: string[]
}

export function SubBlockEditRows({
  blockId,
  rows,
  stateToUse,
  disabled,
  rowKeyPrefix,
  isConnecting = false,
  availableTriggerIds,
}: SubBlockEditRowsProps) {
  return (
    <>
      {rows.map((row, rowIndex) => (
        <div key={`${rowKeyPrefix}-${rowIndex}`} className='flex gap-3'>
          {row.map((subBlock) => (
            <div
              key={getTriggerAwareSubBlockStableKey(
                blockId,
                subBlock,
                stateToUse,
                availableTriggerIds
              )}
              className={subBlock.layout === 'half' ? 'flex-1 space-y-1' : 'w-full space-y-1'}
            >
              <SubBlock
                blockId={blockId}
                config={subBlock}
                isConnecting={isConnecting}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
