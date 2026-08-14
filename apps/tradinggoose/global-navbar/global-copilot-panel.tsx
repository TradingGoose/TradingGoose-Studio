'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useDashboardColorPair } from '@/lib/yjs/use-dashboard-color-pair'
import {
  useGlobalCopilotActiveDashboardLayout,
  useGlobalCopilotCurrentContext,
} from '@/global-navbar/copilot-context'
import type { PairColor } from '@/widgets/pair-colors'
import { PairColorDropdown } from '@/widgets/widgets/components/pair-color-dropdown'
import {
  CopilotHeader,
  CopilotHeaderActions,
} from '@/widgets/widgets/copilot/components/copilot/copilot-header'
import { CopilotApp } from '@/widgets/widgets/copilot/components/copilot-app'

const DEFAULT_PANEL_WIDTH = 1200

export function GlobalCopilotPanel({
  channelId,
  workspaceId,
  ownerUserId,
  dashboardMode,
}: {
  channelId: string
  workspaceId: string
  ownerUserId: string
  dashboardMode: boolean
}) {
  const t = useTranslations('workspace.widgets.surface')
  const currentContext = useGlobalCopilotCurrentContext()
  const publishedActiveLayout = useGlobalCopilotActiveDashboardLayout()
  const [dashboardPairColor, setDashboardPairColor] = useState<PairColor>('gray')
  const activeLayout = dashboardMode ? publishedActiveLayout : null
  const pairColor = activeLayout ? dashboardPairColor : 'gray'
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
  const pairSelected = pairColor !== 'gray'
  const pairFailure = pairSelected ? pairSession.error : null
  const inputDisabled = pairSelected && (!activeLayout || !pairDoc || Boolean(pairFailure))
  const showContextLoading = inputDisabled && !pairFailure
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH)

  useEffect(() => {
    if (!activeLayout) setDashboardPairColor('gray')
  }, [activeLayout])

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
                <PairColorDropdown
                  color={pairColor}
                  onChange={activeLayout ? setDashboardPairColor : undefined}
                />
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
        <div ref={panelRef} className='relative flex min-h-0 flex-1 overflow-hidden p-2'>
          <div
            className='flex h-full min-h-0 w-full min-w-0'
            inert={inputDisabled || undefined}
            aria-hidden={inputDisabled || undefined}
          >
            <CopilotApp
              workspaceId={workspaceId}
              panelWidth={panelWidth}
              channelId={channelId}
              effectiveParams={pairSelected && pairDoc ? pairContext : null}
              layoutId={activeLayout?.id ?? null}
              ownerUserId={activeLayout ? ownerUserId : null}
              layoutName={activeLayout?.name ?? null}
              currentContext={currentContext}
              inputDisabled={inputDisabled}
            />
          </div>
          {pairFailure ? (
            <div className='absolute inset-2 flex flex-col items-center justify-center gap-3 bg-background px-4 text-center text-sm'>
              <p className='text-destructive' role='alert' aria-atomic='true'>
                {t('failedToLoadPairSettings')}
              </p>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={pairSession.retry}
                disabled={pairSession.isRetrying}
                focusableWhenDisabled={pairSession.isRetrying}
                aria-busy={pairSession.isRetrying || undefined}
              >
                {pairSession.isRetrying ? t('retrying') : t('retry')}
              </Button>
            </div>
          ) : showContextLoading ? (
            <div
              className='absolute inset-2 flex items-center justify-center bg-background'
              role='status'
              aria-live='polite'
              aria-atomic='true'
              aria-busy='true'
            >
              <LoadingAgent size='md' />
              <span className='sr-only'>{t('loadingWidget')}</span>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
