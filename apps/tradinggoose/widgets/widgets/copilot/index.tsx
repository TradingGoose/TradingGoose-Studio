import { useEffect, useRef, useState } from 'react'
import { BotMessageSquare } from 'lucide-react'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { copilotWidgetContract } from '@/widgets/widgets/copilot/contract'
import { CopilotHeader, CopilotHeaderActions } from './components/copilot/copilot-header'
import CopilotApp from './components/copilot-app'

const CopilotHeaderActionSlot = ({
  channelId,
  workspaceId,
}: {
  channelId: string
  workspaceId?: string
}) => <CopilotHeaderActions channelId={channelId} workspaceId={workspaceId} />

const CopilotWidgetBody = ({ channelId, context, params }: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const layoutId = context?.dashboardLayoutId ?? null
  const ownerUserId = context?.dashboardLayoutOwnerUserId ?? null
  const layoutName = context?.dashboardLayoutName ?? null
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const defaultPanelWidth = typeof window !== 'undefined' ? window.innerWidth : 1200

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setPanelWidth(containerRef.current.clientWidth)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to load workflows.' />
  }

  return (
    <div ref={containerRef} className='flex h-full w-full overflow-hidden p-2'>
      <CopilotApp
        workspaceId={workspaceId}
        panelWidth={panelWidth || defaultPanelWidth}
        channelId={channelId}
        effectiveParams={params}
        layoutId={layoutId}
        ownerUserId={ownerUserId}
        layoutName={layoutName}
      />
    </div>
  )
}

const WidgetStateMessage = ({ message }: { message: string }) => (
  <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
    {message}
  </div>
)

export const copilotWidget: DashboardWidgetDefinition = {
  contract: copilotWidgetContract,
  icon: BotMessageSquare,
  component: (props) => <CopilotWidgetBody {...props} />,
  renderHeader: ({ channelId, context }) => {
    const workspaceId = context?.workspaceId

    return {
      left: <CopilotHeader channelId={channelId} workspaceId={workspaceId} />,
      right: <CopilotHeaderActionSlot channelId={channelId} workspaceId={workspaceId} />,
    }
  },
}
