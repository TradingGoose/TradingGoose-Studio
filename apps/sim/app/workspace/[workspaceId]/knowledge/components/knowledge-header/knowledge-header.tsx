'use client'

import { LibraryBig, MoreHorizontal, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WorkspaceSelector } from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
} from '@/app/workspace/[workspaceId]/knowledge/components/shared'
import { GlobalNavbarHeader } from '@/global-navbar'

interface BreadcrumbItem {
  label: string
  href?: string
  id?: string
}

const HEADER_STYLES = {
  breadcrumbsWrapper: 'hidden items-center gap-2 sm:flex',
  icon: 'h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70',
  link: 'group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground',
  label: 'font-medium text-sm',
  separator: 'text-muted-foreground',
  actionsContainer: 'flex items-center gap-2',
} as const

interface KnowledgeHeaderOptions {
  knowledgeBaseId?: string
  currentWorkspaceId?: string | null
  onWorkspaceChange?: (workspaceId: string | null) => void
  onDeleteKnowledgeBase?: () => void
}

interface KnowledgeHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  options?: KnowledgeHeaderOptions
  centerContent?: React.ReactNode
}

export function KnowledgeHeader({ breadcrumbs, options, centerContent }: KnowledgeHeaderProps) {
  const breadcrumbContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className={HEADER_STYLES.breadcrumbsWrapper}>
        {breadcrumbs.map((breadcrumb, index) => {
          const key = breadcrumb.id || `${breadcrumb.label}-${breadcrumb.href || index}`

          return (
            <div key={key} className='flex items-center gap-2'>
              {index === 0 && <LibraryBig className={HEADER_STYLES.icon} />}

              {breadcrumb.href ? (
                <Link href={breadcrumb.href} prefetch={true} className={HEADER_STYLES.link}>
                  <span>{breadcrumb.label}</span>
                </Link>
              ) : (
                <span className={HEADER_STYLES.label}>{breadcrumb.label}</span>
              )}

              {index < breadcrumbs.length - 1 && <span className={HEADER_STYLES.separator}>/</span>}
            </div>
          )
        })}
      </div>

      {/* Show compact breadcrumb text on small screens */}
      <div className='flex flex-1 items-center gap-1 text-muted-foreground text-sm sm:hidden'>
        <LibraryBig className='h-[16px] w-[16px]' />
        <span className='truncate'>
          {breadcrumbs[breadcrumbs.length - 1]?.label ?? 'Knowledge'}
        </span>
      </div>
    </div>
  )

  const actionsContent =
    options && (options.knowledgeBaseId || options.onDeleteKnowledgeBase) ? (
      <div className={HEADER_STYLES.actionsContainer}>
        {options.knowledgeBaseId && (
          <WorkspaceSelector
            knowledgeBaseId={options.knowledgeBaseId}
            currentWorkspaceId={options.currentWorkspaceId || null}
            onWorkspaceChange={options.onWorkspaceChange}
          />
        )}

        {options.onDeleteKnowledgeBase && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className={filterButtonClass}
                aria-label='Knowledge base actions menu'
              >
                <MoreHorizontal className='h-4 w-4' />
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
                <DropdownMenuItem
                  onClick={options.onDeleteKnowledgeBase}
                  className='flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 font-[380] text-red-600 text-sm hover:bg-secondary/50 focus:bg-secondary/50 focus:text-red-600'
                >
                  <Trash2 className='h-4 w-4' />
                  Delete Knowledge Base
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    ) : null

  return (
    <GlobalNavbarHeader
      left={breadcrumbContent}
      center={centerContent}
      right={actionsContent ?? undefined}
    />
  )
}
