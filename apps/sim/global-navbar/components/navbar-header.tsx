'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useGlobalNavbarHeaderContext } from '../header-context'

interface NavbarHeaderProps {
  workspaceName?: string | null
  brandName: string
  pageTitle?: string | null
  pageIcon?: LucideIcon
}

export function NavbarHeader({ workspaceName, brandName, pageTitle, pageIcon }: NavbarHeaderProps) {
  const { slots } = useGlobalNavbarHeaderContext()

  return (
    <header className='relative z-10 flex h-14 items-center gap-3 border-b px-4'>
      <SidebarTrigger className='text-muted-foreground' />
      <Separator orientation='vertical' className='h-6' />
      <div className='flex w-full flex-nowrap gap-4 text-sm'>
        <div className='flex min-w-0 flex-grow basis-0 items-center justify-start gap-2'>
          {renderHeaderSlot(
            slots?.left === undefined ? (
              <DefaultPageTitle title={pageTitle ?? workspaceName ?? brandName} icon={pageIcon} />
            ) : (
              slots.left
            )
          )}
        </div>
        <div className='flex min-w-0 flex-grow basis-0 items-center justify-center gap-2 overflow-visible'>
          {renderHeaderSlot(slots?.center ?? null)}
        </div>
        <div className='flex min-w-0 flex-grow basis-0 items-center justify-end gap-2 overflow-visible'>
          {renderHeaderSlot(slots?.right ?? null)}
        </div>
      </div>
    </header>
  )
}

function DefaultPageTitle({ title, icon: Icon }: { title: string; icon?: LucideIcon }) {
  return (
    <div className='group flex items-center gap-2'>
      {Icon ? (
        <Icon className='h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70' />
      ) : null}
      <span className='font-medium text-sm'>{title}</span>
    </div>
  )
}

function renderHeaderSlot(slot?: ReactNode | ReactNode[]) {
  if (!slot) {
    return null
  }

  if (Array.isArray(slot)) {
    return slot.map((node, index) => (
      <span key={index} className='inline-flex items-center gap-2 whitespace-nowrap'>
        {node}
      </span>
    ))
  }

  return slot
}
