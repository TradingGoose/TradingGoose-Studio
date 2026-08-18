'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { useHorizontalWheelScrollRef } from '@/components/widget-header-control'
import {
  CopilotHeader,
  CopilotHeaderActions,
} from '@/lib/copilot/components/copilot/copilot-header'
import { CopilotApp } from '@/lib/copilot/components/copilot-app'
import { useGlobalCopilotCurrentContext } from '@/global-navbar/copilot-context'

const DEFAULT_PANEL_WIDTH = 1200

export function GlobalCopilotPanel({ workspaceId }: { workspaceId: string }) {
  const currentContext = useGlobalCopilotCurrentContext()
  const headerScrollRef = useHorizontalWheelScrollRef<HTMLDivElement>()
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
    <div className='box-border flex h-full max-h-full min-h-0 w-full min-w-0 max-w-full flex-1 basis-0 p-1'>
      <Card className='flex h-full max-h-full min-h-0 w-full max-w-full flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background'>
        <header className='border-border/80 border-b bg-muted/40 text-accent-foreground'>
          <div
            ref={headerScrollRef}
            className='flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          >
            <div className='flex w-full flex-nowrap items-center gap-4 py-0.5 font-medium text-accent-foreground text-sm'>
              <div className='h-8 flex-grow basis-0' />
              <div className='flex h-8 flex-grow basis-0 items-center justify-center gap-1 whitespace-nowrap text-center'>
                <CopilotHeader workspaceId={workspaceId} />
              </div>
              <div className='flex h-8 flex-grow basis-0 items-center justify-end gap-1 whitespace-nowrap pr-1 text-right'>
                <CopilotHeaderActions workspaceId={workspaceId} />
              </div>
            </div>
          </div>
        </header>
        <div ref={panelRef} className='flex min-h-0 flex-1 overflow-hidden p-2'>
          <div className='flex h-full min-h-0 w-full min-w-0'>
            <CopilotApp
              workspaceId={workspaceId}
              panelWidth={panelWidth}
              currentContext={currentContext}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}
