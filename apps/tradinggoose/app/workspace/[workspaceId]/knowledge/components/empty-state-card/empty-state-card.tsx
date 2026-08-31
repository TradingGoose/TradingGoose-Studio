'use client'

import { LibraryBig } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface EmptyStateCardProps {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  icon?: React.ReactNode
}

export function EmptyStateCard({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: EmptyStateCardProps) {
  const t = useTranslations('workspace.knowledge')
  return (
    <div className='flex flex-col gap-3 rounded-md border border-muted-foreground/25 border-dashed bg-background p-4'>
      <div className='flex items-center gap-2'>
        {icon || <LibraryBig className='h-4 w-4 flex-shrink-0 text-muted-foreground' />}
        <h3 className='truncate font-medium text-sm leading-tight'>{title}</h3>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center gap-2 text-muted-foreground text-xs'>
          <span>{t('emptyStateCard.getStarted')}</span>
        </div>

        <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>{description}</p>
        {actionLabel && onAction ? (
          <Button type='button' size='sm' onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
