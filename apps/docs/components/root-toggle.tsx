'use client'
import { type ComponentProps, type ReactNode, useMemo, useState } from 'react'
import { usePathname } from 'fumadocs-core/framework'
import Link from 'fumadocs-core/link'
import { useSidebar } from 'fumadocs-ui/contexts/sidebar'
import type { SidebarTab } from 'fumadocs-ui/utils/get-sidebar-tabs'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { isTabActive } from '../lib/is-active'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export interface Option extends SidebarTab {
  props?: ComponentProps<'a'>
}

export function RootToggle({
  options,
  placeholder,
  ...props
}: {
  placeholder?: ReactNode
  options: Option[]
} & ComponentProps<'button'>) {
  const [open, setOpen] = useState(false)
  const { closeOnRedirect } = useSidebar()
  const pathname = usePathname()

  const selected = useMemo(() => {
    return options.findLast((item) => isTabActive(item, pathname))
  }, [options, pathname])

  const onClick = () => {
    closeOnRedirect.current = false
    setOpen(false)
  }

  const item = selected ? (
    <>
      <div className='size-9 shrink-0 empty:hidden md:size-5'>{selected.icon}</div>
      <div>
        <p className='font-medium text-sm'>{selected.title}</p>
        <p className='text-fd-muted-foreground text-sm empty:hidden md:hidden'>
          {selected.description}
        </p>
      </div>
    </>
  ) : (
    placeholder
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {item && (
        <PopoverTrigger
          {...props}
          className={cn(
            'flex items-center gap-2 rounded-lg border bg-fd-secondary/50 p-2 text-start text-fd-secondary-foreground transition-colors hover:bg-fd-accent data-[state=open]:bg-fd-accent data-[state=open]:text-fd-accent-foreground',
            props.className
          )}
        >
          {item}
          <ChevronsUpDown className='ms-auto size-4 shrink-0 text-fd-muted-foreground' />
        </PopoverTrigger>
      )}
      <PopoverContent className='fd-scroll-container flex w-(--radix-popover-trigger-width) flex-col gap-1 p-1'>
        {options.map((item) => {
          const isActive = selected && item.url === selected.url
          if (!isActive && item.unlisted) return

          return (
            <Link
              key={item.url}
              href={item.url}
              onClick={onClick}
              {...item.props}
              className={cn(
                'flex items-center gap-2 rounded-lg p-1.5 hover:bg-fd-accent hover:text-fd-accent-foreground',
                item.props?.className
              )}
            >
              <div className='size-9 shrink-0 empty:hidden md:mt-1 md:mb-auto md:size-5'>
                {item.icon}
              </div>
              <div>
                <p className='font-medium text-sm'>{item.title}</p>
                <p className='text-[0.8125rem] text-fd-muted-foreground empty:hidden'>
                  {item.description}
                </p>
              </div>

              <Check
                className={cn(
                  'ms-auto size-3.5 shrink-0 text-fd-primary',
                  !isActive && 'invisible'
                )}
              />
            </Link>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
