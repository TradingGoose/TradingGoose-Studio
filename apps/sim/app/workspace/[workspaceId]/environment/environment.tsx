'use client'

import { useRef, useState } from 'react'
import { Braces, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { GlobalNavbarHeader } from '@/global-navbar'
import { Button, Input } from '@/components/ui'
import { PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  EnvironmentVariables,
  type EnvironmentVariablesHandle,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/settings-modal/components/environment/environment'

export function WorkspaceEnvironmentPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const [searchTerm, setSearchTerm] = useState('')
  const [keyScope, setKeyScope] = useState<'workspace' | 'personal'>('workspace')
  const [isCardLoading, setIsCardLoading] = useState(true)
  const envVarRef = useRef<EnvironmentVariablesHandle>(null)

  const headerLeft = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Braces className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>Environment</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search variables...'
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
        className={`h-7 rounded-sm px-3 font-normal text-xs ${keyScope === 'workspace'
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:text-foreground'
          }`}
        aria-pressed={keyScope === 'workspace'}
      >
        Workspace
      </Button>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => setKeyScope('personal')}
        className={`h-7 rounded-sm px-3 font-normal text-xs ${keyScope === 'personal'
            ? 'bg-background text-foreground'
            : 'text-muted-foreground hover:text-foreground'
          }`}
        aria-pressed={keyScope === 'personal'}
      >
        Personal
      </Button>
    </div>
  )

  const headerRight = (
    <PrimaryButton
      onClick={() => envVarRef.current?.addVariable(keyScope)}
      disabled={isCardLoading || (keyScope === 'workspace' && !workspaceId)}
    >
      <Plus className='h-3.5 w-3.5' />
      <span>
        Create {keyScope === 'workspace' ? 'Workspace' : 'Personal'} Environment Variable
      </span>
    </PrimaryButton>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeft} center={headerCenter} right={headerRight} />
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
          <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden p-1'>
            <div className='flex h-full min-h-0 flex-1 flex-col space-y-4'>
              <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background'>
                <EnvironmentVariables
                  ref={envVarRef}
                  workspaceId={workspaceId}
                  variant='page'
                  searchTerm={searchTerm}
                  onSearchTermChange={setSearchTerm}
                  keyScope={keyScope}
                  onLoadingChange={setIsCardLoading}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
