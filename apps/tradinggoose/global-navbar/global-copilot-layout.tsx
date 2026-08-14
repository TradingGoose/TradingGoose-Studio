'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useSelectedLayoutSegments } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  GlobalCopilotContextProvider,
  GlobalCopilotContextPublisher,
  resolveGlobalCopilotRouteContext,
} from '@/global-navbar/copilot-context'
import { GlobalCopilotPanel } from '@/global-navbar/global-copilot-panel'
import { useIsMobile } from '@/hooks/use-mobile'
import { buildCopilotWorkspaceChannelId } from '@/stores/copilot/channel-id'

const COPILOT_PANEL_SIZE = 25
const COPILOT_PANEL_MIN_SIZE = 25
const COPILOT_PANEL_MAX_SIZE = 50
const COPILOT_OVERLAY_BREAKPOINT = 1_536

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
  const compactLayout = useIsMobile(COPILOT_OVERLAY_BREAKPOINT)
  const tCopilot = useTranslations('workspace.nav.copilot')
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
  const copilotPortalContainerRef = useRef<HTMLDivElement>(null)
  const channelId = buildCopilotWorkspaceChannelId({
    authenticatedUserId: ownerUserId,
    workspaceId,
  })

  useEffect(() => {
    const panel = copilotPanelRef.current
    if (!panel) return
    if (compactLayout) {
      if (!panel.isCollapsed()) panel.collapse()
      return
    }
    if (open && panel.isCollapsed()) panel.resize(COPILOT_PANEL_SIZE)
    if (!open && !panel.isCollapsed()) panel.collapse()
  }, [compactLayout, open])

  return (
    <GlobalCopilotContextProvider key={channelId}>
      <GlobalCopilotContextPublisher context={routeContext} />
      <Sheet
        open={open}
        modal={compactLayout}
        disablePointerDismissal={!compactLayout}
        onOpenChange={(nextOpen) => {
          if (compactLayout) onOpenChange(nextOpen)
        }}
      >
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
            onCollapse={() => {
              if (!compactLayout) onOpenChange(false)
            }}
            onExpand={() => {
              if (!compactLayout) onOpenChange(true)
            }}
            inert={open ? undefined : true}
            aria-hidden={open ? undefined : true}
            className='min-h-0 min-w-0 overflow-hidden'
          >
            <div ref={copilotPortalContainerRef} className='relative h-full w-full' />
            <SheetContent
              side='left'
              keepMounted
              portalContainer={copilotPortalContainerRef}
              backdropClassName='2xl:hidden'
              viewportClassName='2xl:contents'
              closeClassName='2xl:hidden'
              initialFocus={compactLayout}
              finalFocus={compactLayout}
              role={compactLayout ? 'dialog' : 'region'}
              className='w-full p-0 pt-8 sm:max-w-[640px] 2xl:absolute 2xl:inset-0 2xl:z-auto 2xl:max-w-none 2xl:border-0 2xl:pt-0 2xl:shadow-none 2xl:transition-none 2xl:data-[ending-style]:animate-none 2xl:data-[starting-style]:animate-none'
            >
              <SheetTitle className='sr-only'>{tCopilot('label')}</SheetTitle>
              <GlobalCopilotPanel
                channelId={channelId}
                workspaceId={workspaceId}
                ownerUserId={ownerUserId}
                dashboardMode={dashboardMode}
              />
            </SheetContent>
          </ResizablePanel>
          <ResizableHandle
            withHandle
            disabled={!open || compactLayout}
            tabIndex={open && !compactLayout ? 0 : -1}
            aria-hidden={open && !compactLayout ? undefined : true}
            className='hidden 2xl:flex'
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
      </Sheet>
    </GlobalCopilotContextProvider>
  )
}
