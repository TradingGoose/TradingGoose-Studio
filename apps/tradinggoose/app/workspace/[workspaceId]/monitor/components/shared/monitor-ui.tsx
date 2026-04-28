'use client'

import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useRef,
  type WheelEvent,
} from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export const monitorControlSurfaceClass =
  'inline-flex h-9 min-w-0 shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 font-normal text-sm text-foreground shadow-none transition-colors ring-offset-background hover:bg-card hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-card data-[state=open]:text-foreground [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0'

export const monitorControlDropdownContentClass = 'max-w-[calc(100vw-2rem)]'

export const monitorControlDropdownContentStyle = {
  width: 'max(var(--radix-dropdown-menu-trigger-width), 12rem)',
  minWidth: 'var(--radix-dropdown-menu-trigger-width)',
} satisfies CSSProperties

export const monitorControlSelectContentStyle = {
  width: 'max(var(--radix-select-trigger-width), 12rem)',
  minWidth: 'var(--radix-select-trigger-width)',
} satisfies CSSProperties

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
    <div
      className={cn(
        'w-full min-w-0 max-w-full shrink-0 overflow-hidden',
        className
      )}
      {...props}
    >
      <div
        ref={scrollRef}
        onWheel={handleWheel}
        className='w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      >
        <div
          role='toolbar'
          aria-label={toolbarLabel}
          className={cn(
            'flex min-h-11 w-max min-w-full items-center gap-1 rounded-md border bg-muted p-1 shadow-sm',
            contentClassName
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

type MonitorControlSelectOption = {
  disabled?: boolean
  label: ReactNode
  value: string
}

type MonitorControlSelectProps = ComponentProps<typeof Select> & {
  children?: ReactNode
  label?: ReactNode
  options?: MonitorControlSelectOption[]
  placeholder?: string
  triggerClassName?: string
}

export function MonitorControlSelect({
  children,
  label,
  options,
  placeholder,
  triggerClassName,
  ...props
}: MonitorControlSelectProps) {
  return (
    <Select {...props}>
      <SelectTrigger className={cn(monitorControlSurfaceClass, triggerClassName)}>
        {label ? <span className='shrink-0 text-xs text-muted-foreground'>{label}</span> : null}
        <span className='min-w-0 truncate text-foreground'>
          <SelectValue placeholder={placeholder} />
        </span>
      </SelectTrigger>
      <SelectContent
        align='start'
        side='bottom'
        className={monitorControlDropdownContentClass}
        style={monitorControlSelectContentStyle}
      >
        {options?.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
        {children}
      </SelectContent>
    </Select>
  )
}

type MonitorControlToggleProps = Omit<ButtonProps, 'size' | 'variant'> & {
  pressed: boolean
}

export function MonitorControlToggle({
  children,
  className,
  pressed,
  type = 'button',
  ...props
}: MonitorControlToggleProps) {
  return (
    <Button
      type={type}
      variant='outline'
      size='sm'
      aria-pressed={pressed}
      className={cn(
        monitorControlSurfaceClass,
        pressed && 'border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15',
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

type MonitorControlMenuProps = {
  children: ReactNode
  className?: string
  disabled?: boolean
  icon?: ReactNode
  iconOnly?: boolean
  label?: ReactNode
  srLabel?: string
  value?: ReactNode
}

export function MonitorControlMenu({
  children,
  className,
  disabled,
  icon,
  iconOnly = false,
  label,
  srLabel,
  value,
}: MonitorControlMenuProps) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className={cn(
            monitorControlSurfaceClass,
            iconOnly ? 'w-9 justify-center px-0' : 'max-w-[220px]',
            className
          )}
          aria-label={srLabel}
        >
          {icon}
          {iconOnly ? <span className='sr-only'>{srLabel}</span> : null}
          {!iconOnly && label ? (
            <span className='shrink-0 text-xs text-muted-foreground'>{label}</span>
          ) : null}
          {!iconOnly && value ? (
            <span className='truncate text-foreground'>{value}</span>
          ) : null}
          {!iconOnly ? <ChevronDown className='ml-0.5 h-4 w-4 text-muted-foreground' /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        className={monitorControlDropdownContentClass}
        style={monitorControlDropdownContentStyle}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
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
