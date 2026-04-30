'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  MonitorAggregateBadges,
  MonitorBoardShell,
  MonitorSectionHeader,
} from '../shared/monitor-ui'
import { KanbanBoard, KanbanCard, KanbanCards } from './kanban'

type MonitorKanbanShellProps = ComponentProps<typeof MonitorBoardShell>

export function MonitorKanbanShell(props: MonitorKanbanShellProps) {
  return <MonitorBoardShell {...props} />
}

type MonitorKanbanSectionProps = ComponentProps<'section'> & {
  actions?: ReactNode
  aggregateBadgeClassName?: string
  aggregateVariant?: BadgeProps['variant']
  aggregates?: Record<string, number | string | undefined>
  description?: ReactNode
  title: ReactNode
}

export function MonitorKanbanSection({
  actions,
  aggregateBadgeClassName,
  aggregateVariant,
  aggregates = {},
  children,
  className,
  description,
  title,
  ...props
}: MonitorKanbanSectionProps) {
  return (
    <section
      className={cn('flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-3', className)}
      {...props}
    >
      <MonitorSectionHeader title={title} description={description}>
        {actions ?? (
          <MonitorAggregateBadges
            entries={aggregates}
            variant={aggregateVariant}
            badgeClassName={aggregateBadgeClassName}
          />
        )}
      </MonitorSectionHeader>
      {children}
    </section>
  )
}

export function MonitorKanbanBoard({ className, ...props }: ComponentProps<typeof KanbanBoard>) {
  return <KanbanBoard className={cn('flex-1 pb-0', className)} {...props} />
}

type MonitorKanbanGroupProps = Omit<ComponentProps<'div'>, 'title'> & {
  title?: ReactNode
}

export function MonitorKanbanGroup({
  children,
  className,
  title,
  ...props
}: MonitorKanbanGroupProps) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)} {...props}>
      {title ? <div className='px-1 font-medium text-muted-foreground text-xs'>{title}</div> : null}
      {children}
    </div>
  )
}

type MonitorKanbanColumnProps = Omit<ComponentProps<typeof KanbanCards>, 'beforeCards'> & {
  aggregateBadgeClassName?: string
  aggregateClassName?: string
  aggregateVariant?: BadgeProps['variant']
  aggregates?: Record<string, number | string | undefined>
  formatAggregateValue?: (field: string, value: number | string | undefined) => ReactNode
  metaAction?: ReactNode
  summary: ReactNode
}

export function MonitorKanbanColumn({
  aggregateBadgeClassName,
  aggregateClassName,
  aggregateVariant,
  aggregates = {},
  children,
  formatAggregateValue,
  listClassName,
  metaAction,
  summary,
  ...props
}: MonitorKanbanColumnProps) {
  return (
    <KanbanCards
      listClassName={cn('space-y-2', listClassName)}
      beforeCards={
        <>
          <div className='flex items-center justify-between border-b px-3 py-2'>
            <div className='text-muted-foreground text-xs'>{summary}</div>
            {metaAction}
          </div>
          <MonitorAggregateBadges
            entries={aggregates}
            className={cn('border-b px-3 py-2', aggregateClassName)}
            variant={aggregateVariant}
            badgeClassName={aggregateBadgeClassName}
            formatValue={formatAggregateValue}
          />
        </>
      }
      {...props}
    >
      {children}
    </KanbanCards>
  )
}

export function MonitorKanbanEmptyCard() {
  return <li className='h-32 rounded-lg bg-muted/20' aria-hidden='true' />
}

type MonitorKanbanCardProps = ComponentProps<typeof KanbanCard>

export function MonitorKanbanCard({ className, ...props }: MonitorKanbanCardProps) {
  return (
    <KanbanCard
      className={cn('space-y-3 px-3 py-3 text-left transition hover:border-primary/50', className)}
      {...props}
    />
  )
}

type MonitorKanbanCardHeaderProps = ComponentProps<'div'> & {
  subtitle?: ReactNode
  title: ReactNode
}

export function MonitorKanbanCardHeader({
  className,
  subtitle,
  title,
  ...props
}: MonitorKanbanCardHeaderProps) {
  return (
    <div className={cn('space-y-1', className)} {...props}>
      <div className='font-medium text-sm'>{title}</div>
      {subtitle ? <div className='text-muted-foreground text-xs'>{subtitle}</div> : null}
    </div>
  )
}

type MonitorKanbanFieldChipProps = {
  active?: boolean
  className?: string
  label: ReactNode
  onClick?: ComponentProps<typeof Button>['onClick']
  value: ReactNode
}

export function MonitorKanbanFieldChip({
  active = false,
  className,
  label,
  onClick,
  value,
}: MonitorKanbanFieldChipProps) {
  const content = (
    <>
      <span className='text-muted-foreground'>{label}</span>
      <span>{value}</span>
    </>
  )

  if (onClick) {
    return (
      <Button
        type='button'
        variant={active ? 'secondary' : 'outline'}
        size='sm'
        aria-pressed={active}
        className={cn(
          'h-6 gap-1 rounded-sm px-2 font-normal text-[11px]',
          active && 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15',
          className
        )}
        onClick={onClick}
      >
        {content}
      </Button>
    )
  }

  return (
    <Badge
      variant='outline'
      className={cn('inline-flex h-6 gap-1 rounded-sm px-2 font-normal text-[11px]', className)}
    >
      {content}
    </Badge>
  )
}
