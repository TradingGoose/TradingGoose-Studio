'use client'

import type { ComponentType, MouseEvent, ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type SidebarDropdownGroup = {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
}

export type SidebarDropdownItem = {
  id: string
  groupId: string
  label: string
  selected?: boolean
  icon?: ReactNode
  content?: ReactNode
}

interface SidebarDropdownMenuContentProps {
  groups: SidebarDropdownGroup[]
  items: SidebarDropdownItem[]
  activeGroupId?: string | null
  highlightedItemId?: string | null
  onActiveGroupChange: (groupId: string) => void
  onSelectItem: (item: SidebarDropdownItem, event: MouseEvent<HTMLButtonElement>) => void
  onHighlightItem?: (item: SidebarDropdownItem, index: number) => void
  loadingContent?: ReactNode
  emptyContent: ReactNode
}

export function SidebarDropdownMenuContent({
  groups,
  items,
  activeGroupId,
  highlightedItemId,
  onActiveGroupChange,
  onSelectItem,
  onHighlightItem,
  loadingContent,
  emptyContent,
}: SidebarDropdownMenuContentProps) {
  const resolvedActiveGroupId = activeGroupId ?? groups[0]?.id ?? ''
  const visibleItems = items.filter((item) => item.groupId === resolvedActiveGroupId)
  const hasGroups = groups.length > 0
  const sidebarShowsOnlyIcons = groups.every((group) => group.icon)

  return (
    <div className='flex h-full max-h-[inherit] min-h-0 flex-col'>
      <div className='flex min-h-0 flex-1 overflow-hidden'>
        {hasGroups ? (
          <div
            className={cn(
              'shrink-0 border-border/70 border-r p-1',
              sidebarShowsOnlyIcons ? 'w-12' : 'w-24'
            )}
          >
            <div
              className={cn(
                'allow-scroll flex h-56 min-w-0 flex-col gap-1 overflow-y-auto items-center [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
              )}
            >
              {groups.map((group) => {
                const Icon = group.icon
                const isActive = group.id === resolvedActiveGroupId
                const groupButton = (
                  <button
                    key={group.id}
                    type='button'
                    aria-label={Icon ? group.label : undefined}
                    data-active={isActive ? 'true' : undefined}
                    className={cn(
                      'flex h-8 w-full min-w-0 items-center rounded-sm text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground',
                      Icon ? 'w-8 shrink-0 justify-center px-0' : 'gap-2 px-2 text-left'
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onActiveGroupChange(group.id)}
                  >
                    {Icon ? (
                      <span className='flex h-4 w-4 shrink-0 items-center justify-center [&_img]:h-3.5 [&_img]:w-3.5 [&_svg]:h-3.5 [&_svg]:w-3.5'>
                        <Icon className='h-3.5 w-3.5 shrink-0' />
                      </span>
                    ) : (
                      <span className='min-w-0 flex-1 truncate'>{group.label}</span>
                    )}
                  </button>
                )

                if (!Icon) return groupButton

                return (
                  <Tooltip key={group.id}>
                    <TooltipTrigger asChild>{groupButton}</TooltipTrigger>
                    <TooltipContent side='left'>{group.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ) : null}
        <div className='allow-scroll h-56 min-w-0 flex-1 overflow-y-auto px-2 py-2'>
          {loadingContent ? (
            <div className='px-2 py-4 text-center text-muted-foreground text-xs'>
              {loadingContent}
            </div>
          ) : visibleItems.length === 0 ? (
            <div className='px-2 py-4 text-center text-muted-foreground text-xs'>
              {emptyContent}
            </div>
          ) : (
            <div className='flex w-full min-w-0 flex-col gap-1'>
              {visibleItems.map((item, index) => (
                <button
                  key={item.id}
                  type='button'
                  data-option-index={index}
                  data-highlighted={highlightedItemId === item.id ? 'true' : undefined}
                  className='relative flex w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-muted-foreground text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground data-[highlighted=true]:bg-accent data-[highlighted=true]:text-accent-foreground'
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => onHighlightItem?.(item, index)}
                  onClick={(event) => onSelectItem(item, event)}
                >
                  {item.content ? (
                    <div className='min-w-0 flex-1'>{item.content}</div>
                  ) : (
                    <>
                      {item.icon}
                      <span className='min-w-0 flex-1 truncate'>{item.label}</span>
                      {item.selected ? <Check className='h-4 w-4 flex-shrink-0' /> : null}
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
