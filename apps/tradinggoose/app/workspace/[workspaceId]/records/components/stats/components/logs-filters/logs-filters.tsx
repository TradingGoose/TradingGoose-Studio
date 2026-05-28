'use client'

import { ScrollArea } from '@/components/ui/scroll-area'
import { useTranslations } from 'next-intl'
import FilterSection from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/filter-section'
import FolderFilter from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/folder'
import Timeline from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/timeline'
import Trigger from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/trigger'
import Workflow from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/workflow'

export function LogsFilters() {
  const t = useTranslations('workspace.logs.dashboard.filters')
  const sections = [
    { key: 'workflow', title: t('workflow'), component: <Workflow /> },
    { key: 'folder', title: t('folder'), component: <FolderFilter /> },
    { key: 'trigger', title: t('trigger'), component: <Trigger /> },
    { key: 'timeline', title: t('timeline'), component: <Timeline /> },
  ]

  return (
    <div className='h-full'>
      <ScrollArea className='h-full' hideScrollbar={true}>
        <div className='space-y-4 px-3 py-3'>
          {sections.map((section) => (
            <FilterSection key={section.key} title={section.title} content={section.component} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
