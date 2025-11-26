'use client'

import { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui'
import { cn } from '@/lib/utils'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  sidebar?: ReactNode
  sidebarClassName?: string
  contentClassName?: string
  headerAction?: ReactNode
  dialogContentClassName?: string
  headerClassName?: string
  titleClassName?: string
}

// Shared modal shell to give global-navbar dialogs the same size/layout as the workspace settings modal
export function SettingsModal({
  open,
  onOpenChange,
  title,
  children,
  sidebar,
  sidebarClassName,
  contentClassName,
  headerAction,
  dialogContentClassName,
  headerClassName,
  titleClassName,
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('flex flex-col max-h-[90%] gap-0 p-0 lg:max-w-[50%] md:max-w-[75%] sm:max-w-[90%] ', dialogContentClassName)}
      >
        <DialogHeader className={cn('border-b px-6 py-4', headerClassName)}>
          <div className='flex items-center justify-between gap-4'>
            <DialogTitle className={cn('font-medium text-lg', titleClassName)}>{title}</DialogTitle>
            {headerAction}
          </div>
        </DialogHeader>

        <div className='flex min-h-0 flex-1 overflow-hidden'>
          {sidebar ? (
            <div className={cn('w-[180px] flex-shrink-0 border-r', sidebarClassName)}>{sidebar}</div>
          ) : null}
          <div className={cn('flex-1 overflow-y-auto', contentClassName)}>{children}</div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
