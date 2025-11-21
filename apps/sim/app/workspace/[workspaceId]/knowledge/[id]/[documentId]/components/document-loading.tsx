'use client'

import { Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  ChunkTableSkeleton,
  KnowledgeHeader,
  PrimaryButton,
} from '@/app/workspace/[workspaceId]/knowledge/components'

interface DocumentLoadingProps {
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentName: string
}

export function DocumentLoading({
  knowledgeBaseId,
  knowledgeBaseName,
  documentName,
}: DocumentLoadingProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const breadcrumbs = [
    {
      id: 'knowledge-root',
      label: 'Knowledge',
      href: `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: `knowledge-base-${knowledgeBaseId}`,
      label: knowledgeBaseName,
      href: `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`,
    },
    {
      id: `document-${knowledgeBaseId}-${documentName}`,
      label: documentName,
    },
  ]

  const headerCenterContent = (
    <div className='flex w-full items-center gap-2 pt-1 sm:gap-3'>
      <div className='relative max-w-md flex-1'>
        <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 text-muted-foreground' />
        <input
          type='text'
          placeholder='Search chunks...'
          value=''
          disabled
          className='flex h-9 w-full rounded-md border border-input bg-background pr-9 pl-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
        />
      </div>
      <PrimaryButton disabled className='h-9 rounded-sm px-3'>
        <Plus className='h-3.5 w-3.5' />
        <span>Create Chunk</span>
      </PrimaryButton>
    </div>
  )

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <KnowledgeHeader breadcrumbs={breadcrumbs} centerContent={headerCenterContent} />

      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
            <div className='min-h-0 flex-1 overflow-auto'>
              <div className='flex min-h-0 flex-1 flex-col p-6'>
                <div className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border'>
                  <ChunkTableSkeleton isSidebarCollapsed={false} rowCount={8} />

                  <div className='flex items-center justify-center border-t bg-background px-6 py-4'>
                    <div className='flex items-center gap-1'>
                      <div className='h-8 w-8 animate-pulse rounded-md bg-muted' />
                      <div className='mx-4 flex items-center gap-6'>
                        {Array.from({ length: 5 }).map((_, idx) => (
                          <div key={idx} className='h-4 w-5 animate-pulse rounded bg-muted' />
                        ))}
                      </div>
                      <div className='h-8 w-8 animate-pulse rounded-md bg-muted' />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
