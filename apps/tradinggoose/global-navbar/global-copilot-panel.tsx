'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { useDashboardColorPair } from '@/lib/yjs/use-dashboard-color-pair'
import { useActiveDashboardLayout } from '@/app/workspace/[workspaceId]/dashboard/use-dashboard-layout-doc'
import type { PairColor } from '@/widgets/pair-colors'
import { PairColorDropdown } from '@/widgets/widgets/components/pair-color-dropdown'
import {
  CopilotHeader,
  CopilotHeaderActions,
} from '@/widgets/widgets/copilot/components/copilot/copilot-header'
import { CopilotApp } from '@/widgets/widgets/copilot/components/copilot-app'

const DEFAULT_PANEL_WIDTH = 1200

export function GlobalCopilotPanel({
  workspaceId,
  ownerUserId,
  dashboardMode,
}: {
  workspaceId: string
  ownerUserId: string
  dashboardMode: boolean
}) {
  const [dashboardPairColor, setDashboardPairColor] = useState<PairColor>('gray')
  const pairColor = dashboardMode ? dashboardPairColor : 'gray'
  const activeLayout = useActiveDashboardLayout(
    dashboardMode ? workspaceId : null,
    dashboardMode ? ownerUserId : null
  )
  const pairSession = useDashboardColorPair({
    workspaceId,
    ownerUserId,
    layoutId: activeLayout?.id ?? null,
    pairColor,
    accessMode: 'read',
    failureMessage: 'Failed to open dashboard color pair',
  })
  const pairDoc = pairSession.doc
  const pairContext = pairSession.context
  const channelId = `copilot-${workspaceId}`
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const updateWidth = () => setPanelWidth(panel.clientWidth || DEFAULT_PANEL_WIDTH)
    updateWidth()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }
    const observer = new ResizeObserver(updateWidth)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  return (
    <div className='box-border flex h-full min-h-0 w-full min-w-0 p-1'>
      <Card className='flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background'>
        <header className='border-border/80 border-b bg-muted/40 text-accent-foreground'>
          <div className='flex w-full items-center gap-4 py-0.5 font-medium text-sm'>
            <div className='flex h-8 flex-1 items-center justify-start pl-1'>
              {dashboardMode ? (
                <PairColorDropdown color={pairColor} onChange={setDashboardPairColor} />
              ) : null}
            </div>
            <div className='flex h-8 flex-1 items-center justify-center'>
              <CopilotHeader channelId={channelId} workspaceId={workspaceId} />
            </div>
            <div className='flex h-8 flex-1 items-center justify-end pr-1'>
              <CopilotHeaderActions channelId={channelId} workspaceId={workspaceId} />
            </div>
          </div>
        </header>
        <div ref={panelRef} className='flex min-h-0 flex-1 overflow-hidden p-2'>
          <CopilotApp
            workspaceId={workspaceId}
            panelWidth={panelWidth}
            channelId={channelId}
            effectiveParams={pairDoc && pairColor !== 'gray' ? pairContext : null}
            layoutId={activeLayout?.id ?? null}
            ownerUserId={activeLayout ? ownerUserId : null}
            layoutName={activeLayout?.name ?? null}
          />
        </div>
      </Card>
    </div>
  )
}
