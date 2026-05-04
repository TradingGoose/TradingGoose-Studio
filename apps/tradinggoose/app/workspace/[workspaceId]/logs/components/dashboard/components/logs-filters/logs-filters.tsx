'use client'

import { useLocale } from 'next-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import FilterSection from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar/components/filters/components/filter-section'
import FolderFilter from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar/components/filters/components/folder'
import Level from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar/components/filters/components/level'
import Timeline from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar/components/filters/components/timeline'
import Trigger from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar/components/filters/components/trigger'
import Workflow from '@/app/workspace/[workspaceId]/logs/components/logs-toolbar/components/filters/components/workflow'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import { useFilterStore } from '@/stores/logs/filters/store'

export function LogsFilters() {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.logs.dashboard.filters
  const viewMode = useFilterStore((state) => state.viewMode)

  const sections = [
    { key: 'level', title: copy.level, component: <Level />, showInDashboard: false },
    { key: 'workflow', title: copy.workflow, component: <Workflow />, showInDashboard: true },
    { key: 'folder', title: copy.folder, component: <FolderFilter />, showInDashboard: true },
    { key: 'trigger', title: copy.trigger, component: <Trigger />, showInDashboard: true },
    { key: 'timeline', title: copy.timeline, component: <Timeline />, showInDashboard: true },
  ]

  const filteredSections =
    viewMode === 'dashboard' ? sections.filter((section) => section.showInDashboard) : sections

  return (
    <div className='h-full'>
      <ScrollArea className='h-full' hideScrollbar={true}>
        <div className='space-y-4 px-3 py-3'>
          {filteredSections.map((section) => (
            <FilterSection
              key={section.key}
              title={section.title}
              content={section.component}
              emptyMessage={formatTemplate(copy.filterOptionsPlaceholder, { title: section.title })}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
