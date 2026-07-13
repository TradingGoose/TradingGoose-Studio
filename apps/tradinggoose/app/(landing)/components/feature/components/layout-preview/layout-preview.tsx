'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { DashboardLayoutPreviewCanvas } from '@/components/dashboard-layout-preview'
import type { LocaleCode } from '@/i18n/utils'
import {
  applyDashboardLayoutStructureMutation,
  closeDashboardTopologyPanel,
  countDashboardTopologyPanels,
  createDefaultDashboardLayoutProjection,
  createDefaultDashboardWidgetDocument,
  type DashboardLayoutEditPlan,
  type DashboardLayoutProjectionContent,
  normalizeDashboardLayoutProjection,
  resolveDashboardLayout,
  splitDashboardTopologyPanel,
} from '@/widgets/layout-document'

function applyPreviewEditPlan(
  current: DashboardLayoutProjectionContent,
  plan: DashboardLayoutEditPlan
): DashboardLayoutProjectionContent {
  const widgets = { ...current.widgets }
  for (const binding of plan.createdBindings) {
    widgets[binding.identityId] = binding.sourceIdentityId
      ? (current.widgets[binding.sourceIdentityId] ??
        createDefaultDashboardWidgetDocument(binding.widgetKey))
      : createDefaultDashboardWidgetDocument(binding.widgetKey)
  }
  for (const identityId of plan.removedIdentityIds) delete widgets[identityId]
  return normalizeDashboardLayoutProjection({ ...current, layout: plan.layout, widgets })
}

export function LayoutPreview() {
  const [mounted, setMounted] = useState(false)
  const [document, setDocument] = useState(createDefaultDashboardLayoutProjection)
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const layoutCopy = copy.landing.preview.layout

  const persistGroupSizes = useCallback((groupId: string, sizes: number[]) => {
    setDocument((current) =>
      applyPreviewEditPlan(
        current,
        applyDashboardLayoutStructureMutation(current.layout, { type: 'resize', groupId, sizes })
      )
    )
  }, [])

  const splitPanelVertical = useCallback((panelId: string) => {
    setDocument((current) => {
      const plan = splitDashboardTopologyPanel(current.layout, panelId, 'vertical')
      return applyPreviewEditPlan(current, plan)
    })
  }, [])

  const splitPanelHorizontal = useCallback((panelId: string) => {
    setDocument((current) => {
      const plan = splitDashboardTopologyPanel(current.layout, panelId, 'horizontal')
      return applyPreviewEditPlan(current, plan)
    })
  }, [])

  const closePanel = useCallback((panelId: string) => {
    setDocument((current) =>
      applyPreviewEditPlan(current, closeDashboardTopologyPanel(current.layout, panelId))
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
