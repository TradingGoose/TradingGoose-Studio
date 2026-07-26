'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { DashboardLayoutPreviewCanvas } from '@/components/dashboard-layout-preview'
import type { LocaleCode } from '@/i18n/utils'
import {
  applyDashboardLayoutEditPlan,
  applyDashboardLayoutStructureMutation,
  closeDashboardTopologyPanel,
  countDashboardTopologyPanels,
  createDefaultDashboardLayoutProjection,
  resolveDashboardLayout,
  splitDashboardTopologyPanel,
} from '@/widgets/layout-document'

export function LayoutPreview() {
  const [mounted, setMounted] = useState(false)
  const [document, setDocument] = useState(createDefaultDashboardLayoutProjection)
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const layoutCopy = copy.workspace.dashboard.layoutPreview

  const persistGroupSizes = useCallback((groupId: string, sizes: number[]) => {
    setDocument((current) =>
      applyDashboardLayoutEditPlan(
        current,
        applyDashboardLayoutStructureMutation(current.layout, { type: 'resize', groupId, sizes })
      )
    )
  }, [])

  const splitPanelVertical = useCallback((panelId: string) => {
    setDocument((current) => {
      const plan = splitDashboardTopologyPanel(current.layout, panelId, 'vertical')
      return applyDashboardLayoutEditPlan(current, plan)
    })
  }, [])

  const splitPanelHorizontal = useCallback((panelId: string) => {
    setDocument((current) => {
      const plan = splitDashboardTopologyPanel(current.layout, panelId, 'horizontal')
      return applyDashboardLayoutEditPlan(current, plan)
    })
  }, [])

  const closePanel = useCallback((panelId: string) => {
    setDocument((current) =>
      applyDashboardLayoutEditPlan(current, closeDashboardTopologyPanel(current.layout, panelId))
    )
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className='flex h-full min-h-[480px] w-full overflow-hidden' />
  }

  return (
    <div className='flex h-full min-h-[480px] w-full overflow-hidden'>
      <DashboardLayoutPreviewCanvas
        closePanel={countDashboardTopologyPanels(document.layout) > 1 ? closePanel : undefined}
        copy={layoutCopy}
        layout={resolveDashboardLayout(document.layout, document.widgets)}
        locale={locale}
        persistGroupSizes={persistGroupSizes}
        splitPanelHorizontal={splitPanelHorizontal}
        splitPanelVertical={splitPanelVertical}
      />
    </div>
  )
}
