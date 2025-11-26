'use client'

import { useRef, useState } from 'react'
import { KeyRound, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { GlobalNavbarHeader } from '@/global-navbar'
import { Input } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  WorkspaceApiKeysCard,
  type WorkspaceApiKeysCardHandle,
} from '@/app/workspace/[workspaceId]/api-keys/workspace-api-keys-card'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { cn } from '@/lib/utils'

export function WorkspaceApiKeysPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const [searchTerm, setSearchTerm] = useState('')
  const [isCardLoading, setIsCardLoading] = useState(true)
  const [keyScope, setKeyScope] = useState<'workspace' | 'personal'>('workspace')
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
        <span className='font-medium text-sm'>
          API Keys
        </span>
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

  const headerCenter = (
    <div className='inline-flex h-9 items-center rounded-md border bg-muted p-1 gap-1 shadow-sm'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setKeyScope('workspace')}
        className={cn(
          'h-7 rounded-sm px-3 font-normal text-xs',
          keyScope === 'workspace'
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={keyScope === 'workspace'}
      >
        Workspace
      </Button>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setKeyScope('personal')}
        className={cn(
          'h-7 rounded-sm px-3 font-normal text-xs',
          keyScope === 'personal'
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
        aria-pressed={keyScope === 'personal'}
      >
        Personal
      </Button>
    </div>
  )

  const headerRight = (
    <PrimaryButton
      onClick={handleStartCreate}
      disabled={(keyScope === 'workspace' && !canManageWorkspaceKeys) || isCardLoading}
    >
      <Plus className='h-3.5 w-3.5' />
      <span>Create {keyScope === 'workspace' ? 'Workspace' : 'Personal'} Key</span>
    </PrimaryButton>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeft} center={headerCenter} right={headerRight} />
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
            <div className='flex h-full min-h-0 flex-1 flex-col space-y-4'>
              <WorkspaceApiKeysCard
                ref={cardRef}
                workspaceId={workspaceId}
                keyScope={keyScope}
                searchTerm={searchTerm}
                onSearchTermChange={setSearchTerm}
                variant='page'
                onLoadingChange={setIsCardLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
