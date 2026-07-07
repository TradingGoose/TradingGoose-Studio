'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { DashboardLayoutPreviewCanvas } from '@/components/dashboard-layout-preview'
import type { LocaleCode } from '@/i18n/utils'
import {
  closeDashboardLayoutPanelGroup,
  createDefaultLayoutState,
  findDashboardLayoutParentGroupId,
  type LayoutNode,
  splitDashboardLayoutPanelIntoHorizontalGroup,
  splitDashboardLayoutPanelIntoVerticalGroup,
  updateDashboardLayoutGroupSizes,
} from '@/widgets/layout'

export function LayoutPreview() {
  const [mounted, setMounted] = useState(false)
  const [tree, setTree] = useState<LayoutNode>(() => createDefaultLayoutState())
  const skipLayoutRef = useRef<Set<string>>(new Set())
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const layoutCopy = copy.landing.preview.layout

  const persistGroupSizes = useCallback((groupId: string, sizes: number[]) => {
    if (skipLayoutRef.current.has(groupId)) {
      skipLayoutRef.current.delete(groupId)
      return
    }

    setTree((prev) => updateDashboardLayoutGroupSizes(prev, groupId, sizes))
  }, [])

  const splitPanelVertical = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findDashboardLayoutParentGroupId(prev, panelId)
      const next = splitDashboardLayoutPanelIntoVerticalGroup(prev, panelId)

      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }

      return next
    })
  }, [])

  const splitPanelHorizontal = useCallback((panelId: string) => {
    setTree((prev) => {
      const parentId = findDashboardLayoutParentGroupId(prev, panelId)
      const next = splitDashboardLayoutPanelIntoHorizontalGroup(prev, panelId)

      if (next !== prev && parentId) {
        skipLayoutRef.current.add(parentId)
      }

      return next
    })
  }, [])

  const closePanel = useCallback((panelId: string) => {
    setTree((prev) => closeDashboardLayoutPanelGroup(prev, panelId))
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
        layout={tree}
        locale={locale}
        persistGroupSizes={persistGroupSizes}
        splitPanelHorizontal={splitPanelHorizontal}
        splitPanelVertical={splitPanelVertical}
      />
    </div>
  )
}
