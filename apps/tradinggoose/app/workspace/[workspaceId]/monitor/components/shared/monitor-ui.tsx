'use client'

import { type ComponentProps, type ReactNode, useCallback, useRef, type WheelEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SearchableDropdown, type SearchableDropdownOption } from './searchable-dropdown'

export const monitorControlSurfaceClass =
  'inline-flex h-9 w-auto min-w-max shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 font-normal text-sm text-foreground shadow-none transition-colors ring-offset-background hover:bg-card hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-card data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0'

type MonitorControlBarProps = ComponentProps<'div'> & {
  contentClassName?: string
  toolbarLabel?: string
}

export function MonitorControlBar({
  children,
  className,
  contentClassName,
  toolbarLabel = 'Monitor controls',
  ...props
}: MonitorControlBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    event.preventDefault()
    scrollRef.current.scrollLeft += event.deltaY
  }, [])

  return (
    <div className={cn('w-full min-w-0 max-w-full shrink-0 overflow-hidden', className)} {...props}>
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className='w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      >
        <div
          role='toolbar'
          aria-label={toolbarLabel}
          className={cn(
            'flex min-h-11 w-max min-w-full items-center gap-1 rounded-xl border bg-muted p-1 shadow-sm',
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

type MonitorControlSelectOption = SearchableDropdownOption & {
  disabled?: boolean
  label: ReactNode
  value: string
}

type MonitorControlSelectProps<TOption extends MonitorControlSelectOption> = {
  disabled?: boolean
  emptyText?: ReactNode
  label?: ReactNode
  onValueChange: (value: string) => void
  options: TOption[]
  placeholder?: ReactNode
  renderOption?: (option: TOption, selected: boolean) => ReactNode
  renderTriggerValue?: (selected: TOption | null) => ReactNode
  searchPlaceholder?: string
  triggerClassName?: string
  value?: string | null
}

const getSearchPlaceholder = (label: ReactNode) =>
  typeof label === 'string' ? `Search ${label.toLowerCase()}...` : 'Search options...'

export function MonitorControlSelect<TOption extends MonitorControlSelectOption>({
  disabled,
  emptyText = 'No options found.',
  label,
  options,
  onValueChange,
  placeholder,
  renderOption,
  renderTriggerValue,
  searchPlaceholder = getSearchPlaceholder(label),
  triggerClassName,
  value,
}: MonitorControlSelectProps<TOption>) {
  return (
    <SearchableDropdown
      value={value}
      options={options}
      placeholder={placeholder ?? ''}
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      disabled={disabled}
      triggerClassName={cn(monitorControlSurfaceClass, triggerClassName)}
      triggerLabel={typeof label === 'string' ? label : undefined}
      onValueChange={onValueChange}
      renderOption={renderOption}
      renderTriggerValue={
        renderTriggerValue ??
        ((selected) => (
          <div className='flex shrink-0 items-center gap-2'>
            {label ? <span className='shrink-0 text-muted-foreground text-xs'>{label}</span> : null}
            <span className='shrink-0 text-foreground'>{selected?.label ?? placeholder}</span>
          </div>
        ))
      }
    />
  )
}

type MonitorControlMenuOption = SearchableDropdownOption & {
  selected?: boolean
}

type MonitorControlMenuProps<TOption extends MonitorControlMenuOption> = {
  closeOnSelect?: boolean
  disabled?: boolean
  label?: ReactNode
  onValueChange: (value: string) => void
  options: TOption[]
  renderOption?: (option: TOption, selected: boolean) => ReactNode
  searchPlaceholder?: string
  triggerClassName?: string
  value?: ReactNode
}

export function MonitorControlMenu<TOption extends MonitorControlMenuOption>({
  closeOnSelect = false,
  disabled,
  label,
  onValueChange,
  options,
  renderOption,
  searchPlaceholder = getSearchPlaceholder(label),
  triggerClassName,
  value,
}: MonitorControlMenuProps<TOption>) {
  return (
    <SearchableDropdown
      closeOnSelect={closeOnSelect}
      value={null}
      options={options}
      placeholder=''
      searchPlaceholder={searchPlaceholder}
      emptyText='No options found.'
      disabled={disabled}
      triggerClassName={cn(monitorControlSurfaceClass, triggerClassName)}
      triggerLabel={typeof label === 'string' ? label : undefined}
      onValueChange={onValueChange}
      isOptionSelected={(option) => Boolean(option.selected)}
      renderOption={renderOption}
      renderTriggerValue={() => (
        <>
          {label ? <span className='shrink-0 text-muted-foreground text-xs'>{label}</span> : null}
          {value ? <span className='shrink-0 text-foreground'>{value}</span> : null}
        </>
      )}
    />
  )
}

type MonitorBoardShellProps = ComponentProps<typeof Card> & {
  contentClassName?: string
}

export function MonitorBoardShell({
  children,
  className,
  contentClassName,
  ...props
}: MonitorBoardShellProps) {
  return (
    <Card
      className={cn(
        'flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden rounded-xl border bg-card/40 p-1.5',
        className
      )}
      {...props}
    >
      <CardContent
        className={cn(
          'flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-4 overflow-auto p-4',
          contentClassName
        )}
      >
        {children}
      </CardContent>
    </Card>
  )
}

type MonitorSectionHeaderProps = ComponentProps<'div'> & {
  description?: ReactNode
  title: ReactNode
}

export function MonitorSectionHeader({
  children,
  className,
  description,
  title,
  ...props
}: MonitorSectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)} {...props}>
      <div>
        <h2 className='font-medium text-sm'>{title}</h2>
        {description ? <p className='text-muted-foreground text-xs'>{description}</p> : null}
      </div>
      {children ? <div className='flex gap-2'>{children}</div> : null}
    </div>
  )
}

type MonitorAggregateBadgesProps = ComponentProps<'div'> & {
  badgeClassName?: string
  entries: Record<string, number | string | undefined>
  formatValue?: (field: string, value: number | string | undefined) => ReactNode
  variant?: BadgeProps['variant']
}

export function MonitorAggregateBadges({
  badgeClassName,
  className,
  entries,
  formatValue,
  variant = 'outline',
  ...props
}: MonitorAggregateBadgesProps) {
  const aggregateEntries = Object.entries(entries)
  if (aggregateEntries.length === 0) return null

  return (
    <div
      className={cn('flex flex-wrap gap-2 text-[11px] text-muted-foreground', className)}
      {...props}
    >
      {aggregateEntries.map(([field, value]) => (
        <Badge
          key={field}
          variant={variant}
          className={cn('rounded-sm font-normal text-[11px]', badgeClassName)}
        >
          {field}: {formatValue ? formatValue(field, value) : (value ?? 0)}
        </Badge>
      ))}
    </div>
  )
}

type MonitorStateCardProps = ComponentProps<typeof Card> & {
  actionDisabled?: boolean
  actionLabel?: ReactNode
  children?: ReactNode
  contentClassName?: string
  description?: ReactNode
  loadingLabel?: ReactNode
  onAction?: () => void
  title?: ReactNode
}

export function MonitorStateCard({
  actionDisabled,
  actionLabel,
  children,
  className,
  contentClassName,
  description,
  loadingLabel,
  onAction,
  title,
  ...props
}: MonitorStateCardProps) {
  return (
    <Card
      className={cn('flex items-center justify-center rounded-xl border bg-card/40', className)}
      {...props}
    >
      <CardContent
        className={cn(
          'flex max-w-md flex-col items-center gap-3 p-6 text-center text-muted-foreground text-sm',
          contentClassName
        )}
      >
        {loadingLabel ? (
          <div className='flex items-center gap-2'>
            <Loader2 className='h-4 w-4 animate-spin' />
            {loadingLabel}
          </div>
        ) : (
          <>
            {title || description ? (
              <CardHeader className='space-y-1 p-0'>
                {title ? (
                  <CardTitle className='font-medium text-foreground text-sm'>{title}</CardTitle>
                ) : null}
                {description ? (
                  <CardDescription className='max-w-sm'>{description}</CardDescription>
                ) : null}
              </CardHeader>
            ) : null}
            {children}
            {actionLabel && onAction ? (
              <Button variant='outline' size='sm' onClick={onAction} disabled={actionDisabled}>
                {actionLabel}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
