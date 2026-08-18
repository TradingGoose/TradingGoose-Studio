'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { GlobalCopilotContextProvider } from '@/global-navbar/copilot-context'
import { GlobalCopilotPanel } from '@/global-navbar/global-copilot-panel'
import { buildCopilotWorkspaceChannelId } from '@/stores/copilot/channel-id'
import { CopilotStoreProvider } from '@/stores/copilot/store'

const COPILOT_PANEL_SIZE = 25
const COPILOT_PANEL_MIN_SIZE = 25
const COPILOT_PANEL_MAX_SIZE = 50

export function GlobalCopilotLayout({
  children,
  workspaceId,
  ownerUserId,
  open,
  onOpenChange,
}: {
  children: React.ReactNode
  workspaceId: string
  ownerUserId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const tCopilot = useTranslations('workspace.nav.copilot')
  const copilotPanelRef = useRef<ImperativePanelHandle>(null)
  const channelId = buildCopilotWorkspaceChannelId({
    authenticatedUserId: ownerUserId,
    workspaceId,
  })
  const [mountedChannelId, setMountedChannelId] = useState<string | null>(() =>
    open ? channelId : null
  )
  const shouldMountCopilot = open || mountedChannelId === channelId

  useEffect(() => {
    if (open) {
      setMountedChannelId(channelId)
    } else if (mountedChannelId && mountedChannelId !== channelId) {
      setMountedChannelId(null)
    }
  }, [channelId, mountedChannelId, open])

  useEffect(() => {
    const panel = copilotPanelRef.current
    if (!panel) return
    if (open && panel.isCollapsed()) panel.resize(COPILOT_PANEL_SIZE)
    if (!open && !panel.isCollapsed()) panel.collapse()
  }, [open])

  return (
    <GlobalCopilotContextProvider key={channelId}>
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
          inert={open ? undefined : true}
          aria-hidden={open ? undefined : true}
          aria-label={tCopilot('label')}
          role='region'
          className='min-h-0 min-w-0 overflow-hidden'
        >
          {shouldMountCopilot ? (
            <CopilotStoreProvider channelId={channelId}>
              <GlobalCopilotPanel workspaceId={workspaceId} ownerUserId={ownerUserId} />
            </CopilotStoreProvider>
          ) : null}
        </ResizablePanel>
        <ResizableHandle
          withHandle
          disabled={!open}
          tabIndex={open ? 0 : -1}
          aria-hidden={open ? undefined : true}
        />
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
