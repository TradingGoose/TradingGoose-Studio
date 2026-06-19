'use client'

import type { LucideIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import {
  useGlobalNavbarHeaderActiveSlots,
  useGlobalNavbarHeaderSlotTarget,
} from '../header-context'

interface NavbarHeaderProps {
  workspaceName?: string | null
  brandName: string
  pageTitle?: string | null
  pageIcon?: LucideIcon
}

export function NavbarHeader({ workspaceName, brandName, pageTitle, pageIcon }: NavbarHeaderProps) {
  const activeSlots = useGlobalNavbarHeaderActiveSlots()
  const leftSlotTarget = useGlobalNavbarHeaderSlotTarget('left')
  const centerSlotTarget = useGlobalNavbarHeaderSlotTarget('center')
  const rightSlotTarget = useGlobalNavbarHeaderSlotTarget('right')

  return (
    <header className='relative z-10 flex h-12 items-center gap-3 border-b px-4'>
      <div className='flex w-full flex-nowrap gap-2 text-sm'>
        <div className='flex min-w-0 flex-grow basis-[30%] items-center justify-start gap-2'>
          <SidebarTrigger className='text-muted-foreground' />
          <Separator orientation='vertical' className='h-6' />
          {activeSlots.left ? (
            <span ref={leftSlotTarget} className='contents' />
          ) : (
            <DefaultPageTitle title={pageTitle ?? workspaceName ?? brandName} icon={pageIcon} />
          )}
        </div>
        <div className='flex min-w-0 flex-grow basis-[40%] items-center justify-center gap-2 overflow-visible'>
          {activeSlots.center ? <span ref={centerSlotTarget} className='contents' /> : null}
        </div>
        <div className='flex min-w-0 flex-grow basis-[30%] items-center justify-end gap-2 overflow-visible'>
          {activeSlots.right ? <span ref={rightSlotTarget} className='contents' /> : null}
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
