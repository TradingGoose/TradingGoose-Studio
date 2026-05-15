import { Card } from '@/components/ui/card'
import { getIconTileStyle, sanitizeSolidIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import { type ConnectedBlock, useBlockConnections } from '@/hooks/workflow/use-block-connections'
import { getSubflowBlockConfig } from '@/widgets/widgets/editor_workflow/components/subflows/config'

interface ConnectionBlocksProps {
  blockId: string
  horizontalHandles: boolean
  setIsConnecting: (isConnecting: boolean) => void
  isDisabled?: boolean
}

export function ConnectionBlocks({
  blockId,
  horizontalHandles,
  setIsConnecting,
  isDisabled = false,
}: ConnectionBlocksProps) {
  const { incomingConnections, hasIncomingConnections } = useBlockConnections(blockId)

  if (!hasIncomingConnections) return null

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, connection: ConnectedBlock) => {
    if (isDisabled) {
      e.preventDefault()
      return
    }

    e.stopPropagation() // Prevent parent drag handlers from firing
    setIsConnecting(true)

    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'connectionBlock',
        connectionData: {
          sourceBlockId: connection.id,
        },
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDragEnd = () => {
    setIsConnecting(false)
  }

  const sortedConnections = incomingConnections

  const renderConnectionCard = (connection: ConnectedBlock) => {
    const blockConfig = getBlock(connection.type)
    const subflowConfig = getSubflowBlockConfig(connection.type)
    const Icon = blockConfig?.icon ?? subflowConfig?.icon
    const bgColor = sanitizeSolidIconColor(blockConfig?.bgColor ?? subflowConfig?.bgColor)

    return (
      <Card
        key={`${connection.id}-${connection.name}`}
        draggable={!isDisabled}
        onDragStart={(e) => handleDragStart(e, connection)}
        onDragEnd={handleDragEnd}
        className={cn(
          'group flex w-max items-center gap-2 rounded-md border bg-card p-1 shadow-xs transition-colors',
          !isDisabled
            ? 'cursor-grab hover:bg-card active:cursor-grabbing'
            : 'cursor-not-allowed opacity-60'
        )}
      >
        {Icon && (
          <div
            className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-xs bg-secondary text-foreground'
            style={getIconTileStyle(bgColor)}
          >
            <Icon className='h-4 w-4' />
          </div>
        )}
      </Card>
    )
  }

  // Position and layout based on handle orientation.
  // When ports are horizontal: connection blocks on bottom, aligned to left.
  // When ports are vertical (default): connection blocks on left, stack vertically, aligned to right.
  const containerClasses = horizontalHandles
    ? 'absolute top-full left-0 flex max-w-[600px] flex-wrap gap-2 pt-2'
    : 'absolute top-0 right-full flex max-h-[400px] max-w-[200px] flex-col items-end gap-2 overflow-y-auto pr-3'

  return <div className={containerClasses}>{sortedConnections.map(renderConnectionCard)}</div>
}
