import { useEffect, useRef, useState } from 'react'
import { BotMessageSquare } from 'lucide-react'
import { resolveWidgetChannel } from '@/widgets/hooks/use-widget-channel'
import type { WidgetInstance } from '@/widgets/layout'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { CopilotHeader, CopilotHeaderActions } from './components/copilot/copilot-header'
import CopilotApp from './components/copilot-app'

const COPILOT_WIDGET_KEY = 'copilot'

const resolveCopilotWidgetScope = ({
  pairColor,
  panelId,
  widget,
}: Pick<WidgetComponentProps, 'pairColor' | 'panelId' | 'widget'>) => {
  const { resolvedPairColor, widgetKey } = resolveWidgetChannel({
    pairColor,
    widget,
    panelId,
    fallbackWidgetKey: COPILOT_WIDGET_KEY,
  })
  const normalizedPanelId = panelId && panelId.trim().length > 0 ? panelId : 'panel'

  return {
    resolvedPairColor,
    channelId: `${widgetKey}-${normalizedPanelId}`,
  }
}

const CopilotHeaderActionSlot = ({
  channelId,
  widget,
}: {
  channelId: string
  widget: WidgetInstance
}) => {
  return <CopilotHeaderActions channelId={channelId} />
}

const CopilotWidgetBody = ({
  context,
  pairColor = 'gray',
  panelId,
  widget,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId
  const { channelId, resolvedPairColor } = resolveCopilotWidgetScope({
    pairColor,
    widget,
    panelId,
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [panelWidth, setPanelWidth] = useState(0)
  const fallbackPanelWidth = typeof window !== 'undefined' ? window.innerWidth : 1200

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
        panelWidth={panelWidth || fallbackPanelWidth}
        channelId={channelId}
        pairColor={resolvedPairColor}
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
  key: 'copilot',
  title: 'Copilot',
  icon: BotMessageSquare,
  category: 'utility',
  description: 'AI copilot experience across workflows and workspace tools.',
  component: (props) => <CopilotWidgetBody {...props} />,
  renderHeader: ({ widget, panelId }) => {
    const { channelId } = resolveCopilotWidgetScope({
      pairColor: widget?.pairColor ?? 'gray',
      widget,
      panelId,
    })

    return {
      left: <CopilotHeader channelId={channelId} />,
      right: <CopilotHeaderActionSlot channelId={channelId} widget={widget} />,
    }
  },
}
