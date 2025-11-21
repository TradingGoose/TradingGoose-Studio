'use client'

import { useRef, useState } from 'react'
import { KeyRound, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { GlobalNavbarHeader } from '@/global-navbar'
import { Input } from '@/components/ui'
import { PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  WorkspaceApiKeysCard,
  type WorkspaceApiKeysCardHandle,
} from '@/app/workspace/[workspaceId]/api-keys/workspace-api-keys-card'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

export function WorkspaceApiKeysPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const [searchTerm, setSearchTerm] = useState('')
  const [isCardLoading, setIsCardLoading] = useState(true)
  const cardRef = useRef<WorkspaceApiKeysCardHandle>(null)
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  const handleStartCreate = () => {
    cardRef.current?.openCreateDialog()
  }

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <KeyRound className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Workspace API Keys</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search keys...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  const headerRight = (
    <PrimaryButton onClick={handleStartCreate} disabled={!canManageWorkspaceKeys || isCardLoading}>
      <Plus className='h-3.5 w-3.5' />
      <span>Create Key</span>
    </PrimaryButton>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeft} right={headerRight} />
      <div className='flex h-screen flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex-1 overflow-auto'>
              <div className='relative flex h-full flex-col'>
                <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
                  <div className='space-y-6 py-6'>
                    <WorkspaceApiKeysCard
                      ref={cardRef}
                      workspaceId={workspaceId}
                      searchTerm={searchTerm}
                      onSearchTermChange={setSearchTerm}
                      variant='page'
                      onLoadingChange={setIsCardLoading}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
