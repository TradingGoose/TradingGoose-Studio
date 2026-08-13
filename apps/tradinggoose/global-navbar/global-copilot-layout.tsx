'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useSelectedLayoutSegments } from 'next/navigation'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import {
  GlobalCopilotContextProvider,
  GlobalCopilotContextPublisher,
  resolveGlobalCopilotRouteContext,
} from '@/global-navbar/copilot-context'
import { GlobalCopilotPanel } from '@/global-navbar/global-copilot-panel'

const COPILOT_PANEL_SIZE = 25
const COPILOT_PANEL_MIN_SIZE = 5
const COPILOT_PANEL_MAX_SIZE = 50

export function GlobalCopilotLayout({
  children,
  workspaceId,
  ownerUserId,
  dashboardMode,
  open,
  onOpenChange,
}: {
  children: React.ReactNode
  workspaceId: string
  ownerUserId: string
  dashboardMode: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const segments = useSelectedLayoutSegments()
  const routeWorkspaceId = segments[0]
  const routeSection = segments[1]
  const routeEntityId = segments[2]
  const routeContext = useMemo(
    () =>
      resolveGlobalCopilotRouteContext(
        [routeWorkspaceId, routeSection, routeEntityId].filter(
          (segment): segment is string => typeof segment === 'string'
        ),
        workspaceId
      ),
    [routeEntityId, routeSection, routeWorkspaceId, workspaceId]
  )
  const copilotPanelRef = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    const panel = copilotPanelRef.current
    if (!panel) return
    if (open && panel.isCollapsed()) panel.resize(COPILOT_PANEL_SIZE)
    if (!open && !panel.isCollapsed()) panel.collapse()
  }, [open])

  return (
    <GlobalCopilotContextProvider key={workspaceId}>
      <GlobalCopilotContextPublisher context={routeContext} />
      <ResizablePanelGroup direction='horizontal' className='min-h-0 w-full flex-1'>
        <ResizablePanel
          ref={copilotPanelRef}
          id='workspace-copilot'
          order={1}
          minSize={COPILOT_PANEL_MIN_SIZE}
          maxSize={COPILOT_PANEL_MAX_SIZE}
          defaultSize={open ? COPILOT_PANEL_SIZE : 0}
          collapsible
          collapsedSize={0}
          onCollapse={() => onOpenChange(false)}
          onExpand={() => onOpenChange(true)}
          className='min-h-0 min-w-0 overflow-hidden'
        >
          <GlobalCopilotPanel
            workspaceId={workspaceId}
            ownerUserId={ownerUserId}
            dashboardMode={dashboardMode}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          id='workspace-page'
          order={2}
          minSize={100 - COPILOT_PANEL_MAX_SIZE}
          defaultSize={open ? 100 - COPILOT_PANEL_SIZE : 100}
        >
          <div className='h-full min-h-0 overflow-hidden'>
            <div className='h-full w-full overflow-auto'>{children}</div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </GlobalCopilotContextProvider>
  )
}
