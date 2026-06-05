'use client'

import { Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  DocumentTableSkeleton,
  KnowledgeHeader,
  PrimaryButton,
  SearchInput,
} from '@/app/workspace/[workspaceId]/knowledge/components'

interface KnowledgeBaseLoadingProps {
  knowledgeBaseName: string
}

export function KnowledgeBaseLoading({ knowledgeBaseName }: KnowledgeBaseLoadingProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const t = useTranslations('workspace.knowledge')

  const breadcrumbs = [
    {
      id: 'knowledge-root',
      label: t('title'),
      href: `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: 'knowledge-base-loading',
      label: knowledgeBaseName,
    },
  ]

  const headerCenterContent = (
    <div className='flex flex-wrap items-center justify-between gap-3 pt-1'>
      <SearchInput
        value=''
        onChange={() => {}}
        placeholder={t('loading.searchDocumentsPlaceholder')}
        disabled
        className='flex-1'
      />
      <div className='flex items-center gap-2'>
        <PrimaryButton disabled>
          <Plus className='h-3.5 w-3.5' />
          {t('loading.addDocuments')}
        </PrimaryButton>
      </div>
    </div>
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <KnowledgeHeader breadcrumbs={breadcrumbs} centerContent={headerCenterContent} />

      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex h-full min-h-0 flex-1 flex-col '>
            <div className='flex h-full min-h-0 min-w-0 flex-1 overflow-hidden p-1'>
              <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
                <DocumentTableSkeleton isSidebarCollapsed={false} rowCount={8} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
