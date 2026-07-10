'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { DashboardLayoutPreviewCanvas } from '@/components/dashboard-layout-preview'
import type { LocaleCode } from '@/i18n/utils'
import {
  closeDashboardTopologyPanel,
  createDefaultDashboardLayoutContent,
  type DashboardLayoutTopologyNode,
  findDashboardTopologyParentGroupId,
  resolveDashboardLayout,
  splitDashboardTopologyPanel,
  updateDashboardTopologyGroupSizes,
} from '@/widgets/layout-document'

export function LayoutPreview() {
  const [mounted, setMounted] = useState(false)
  const [tree, setTree] = useState<DashboardLayoutTopologyNode>(
    () => createDefaultDashboardLayoutContent().layout
  )
  const skipLayoutRef = useRef<Set<string>>(new Set())
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const layoutCopy = copy.landing.preview.layout

  const persistGroupSizes = useCallback((groupId: string, sizes: number[]) => {
    if (skipLayoutRef.current.has(groupId)) {
      skipLayoutRef.current.delete(groupId)
      return
    }

    setTree((prev) => updateDashboardTopologyGroupSizes(prev, groupId, sizes))
  }, [])

  const splitPanelVertical = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findDashboardTopologyParentGroupId(prev, panelId)
      const next = splitDashboardTopologyPanel(prev, {}, panelId, 'vertical').layout

      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }

      return next
    })
  }, [])

  const splitPanelHorizontal = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findDashboardTopologyParentGroupId(prev, panelId)
      const next = splitDashboardTopologyPanel(prev, {}, panelId, 'horizontal').layout

      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }

      return next
    })
  }, [])

  const closePanel = useCallback((panelId: string) => {
    setTree((prev) => closeDashboardTopologyPanel(prev, panelId).layout)
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
        closePanel={closePanel}
        copy={layoutCopy}
        layout={resolveDashboardLayout(tree, {})}
        locale={locale}
        persistGroupSizes={persistGroupSizes}
        splitPanelHorizontal={splitPanelHorizontal}
        splitPanelVertical={splitPanelVertical}
      />
    </div>
  )
}
