'use client'

import { useEffect, useRef } from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
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
  const copilotPanelRef = useRef<ImperativePanelHandle>(null)

  useEffect(() => {
    const panel = copilotPanelRef.current
    if (!panel) return
    if (open && panel.isCollapsed()) panel.resize(COPILOT_PANEL_SIZE)
    if (!open && !panel.isCollapsed()) panel.collapse()
  }, [open])

  return (
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
          key={workspaceId}
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
  )
}
