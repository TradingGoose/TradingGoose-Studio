'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, LibraryBig, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  BaseOverview,
  CreateModal,
  EmptyStateCard,
  KnowledgeBaseCardSkeletonGrid,
  PrimaryButton,
  SearchInput,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  SORT_OPTION_DEFINITIONS,
  type SortOrder,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'
import {
  filterKnowledgeBases,
  sortKnowledgeBases,
} from '@/app/workspace/[workspaceId]/knowledge/utils/sort'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { GlobalNavbarHeader } from '@/global-navbar'
import { useKnowledgeBasesList } from '@/hooks/use-knowledge'
import type { KnowledgeBaseData } from '@/stores/knowledge/store'

export function Knowledge() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const t = useTranslations('workspace.knowledge')

  const { knowledgeBases, isLoading, error, addKnowledgeBase, refreshList } =
    useKnowledgeBasesList(workspaceId)
  const userPermissions = useUserPermissionsContext()
  const canManageKnowledgeBases = userPermissions.canEdit === true

  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const currentSortValue = `name-${sortOrder}`
  const sortOptions = useMemo(
    () =>
      SORT_OPTION_DEFINITIONS.map((option) => ({
        ...option,
        label: t(option.labelKey),
      })),
    [t]
  )
  const currentSortLabel =
    sortOptions.find((opt) => opt.value === currentSortValue)?.label || t('sort.nameAsc')

  const handleSortChange = (value: string) => {
    const [, order] = value.split('-') as ['name', SortOrder]
    setSortOrder(order)
  }

  const handleKnowledgeBaseCreated = (newKnowledgeBase: KnowledgeBaseData) => {
    addKnowledgeBase(newKnowledgeBase)
  }

  const handleRetry = () => {
    refreshList()
  }

  const filteredAndSortedKnowledgeBases = useMemo(() => {
    const filtered = filterKnowledgeBases(knowledgeBases, searchQuery)
    return sortKnowledgeBases(filtered, sortOrder)
  }, [knowledgeBases, searchQuery, sortOrder])

  const formatKnowledgeBaseForDisplay = (kb: KnowledgeBaseData) => ({
    id: kb.id,
    title: kb.name,
    description: kb.description || t('defaults.noDescriptionProvided'),
  })

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <LibraryBig className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>{t('title')}</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('searchPlaceholder')}
          className='w-full'
        />
      </div>
    </div>
  )

  const headerRightContent = (
    <div className='flex items-center gap-2'>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' size='sm' className={filterButtonClass}>
            {currentSortLabel}
            <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          side='bottom'
          avoidCollisions={false}
          sideOffset={4}
          className={dropdownContentClass}
        >
          <div className={`${commandListClass} py-1`}>
            {sortOptions.map((option, index) => (
              <div key={option.value}>
                <DropdownMenuItem
                  onSelect={() => handleSortChange(option.value)}
                  className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
                >
                  <span>{option.label}</span>
                  {currentSortValue === option.value && (
                    <Check className='h-4 w-4 text-muted-foreground' />
                  )}
                </DropdownMenuItem>
                {index === 0 && <DropdownMenuSeparator />}
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <PrimaryButton
            onClick={() => setIsCreateModalOpen(true)}
            disabled={!canManageKnowledgeBases}
          >
            <Plus className='h-3.5 w-3.5' />
            <span>{t('actions.create')}</span>
          </PrimaryButton>
        </TooltipTrigger>
        {userPermissions.canEdit !== true && (
          <TooltipContent>{t('actions.createTooltip')}</TooltipContent>
        )}
      </Tooltip>
    </div>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} right={headerRightContent} />
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex min-h-0 min-w-0 flex-1 overflow-hidden p-1'>
          <div className='flex min-h-0 flex-1 flex-col overflow-hidden '>
            <div className='min-h-0 flex-1 overflow-auto'>
              <div className='p-2'>
                {/* Error State */}
                {error && (
                  <div className='mb-4 rounded-md border border-red-200 bg-red-50 p-4'>
                    <p className='text-red-800 text-sm'>{t('errors.load', { error })}</p>
                    <button
                      onClick={handleRetry}
                      className='mt-2 text-red-600 text-sm underline hover:text-red-800'
                    >
                      {t('errors.retry')}
                    </button>
                  </div>
                )}

                {/* Content Area */}
                {isLoading ? (
                  <KnowledgeBaseCardSkeletonGrid count={8} />
                ) : (
                  <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                    {filteredAndSortedKnowledgeBases.length === 0 ? (
                      knowledgeBases.length === 0 ? (
                        <EmptyStateCard
                          title={t('emptyState.createFirst')}
                          description={
                            userPermissions.canEdit === true
                              ? t('emptyState.withEditPermission')
                              : t('emptyState.withoutEditPermission')
                          }
                          buttonText={
                            userPermissions.canEdit === true
                              ? t('emptyState.buttonCreate')
                              : t('emptyState.buttonContactAdmin')
                          }
                          onClick={
                            userPermissions.canEdit === true
                              ? () => setIsCreateModalOpen(true)
                              : () => {}
                          }
                          icon={<LibraryBig className='h-4 w-4 text-muted-foreground' />}
                        />
                      ) : (
                        <div className='col-span-full py-12 text-center'>
                          <p className='text-muted-foreground'>{t('emptyState.noMatches')}</p>
                        </div>
                      )
                    ) : (
                      filteredAndSortedKnowledgeBases.map((kb) => {
                        const displayData = formatKnowledgeBaseForDisplay(kb)
                        return (
                          <BaseOverview
                            key={kb.id}
                            id={displayData.id}
                            title={displayData.title}
                            description={displayData.description}
                            canEdit={canManageKnowledgeBases}
                          />
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      <CreateModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onKnowledgeBaseCreated={handleKnowledgeBaseCreated}
      />
    </>
  )
}
