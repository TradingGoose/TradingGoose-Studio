'use client'

import { cn } from '../../../lib/cn'
import { type ComponentProps, type ReactNode, useMemo } from 'react'
import { useSidebar } from 'fumadocs-ui/contexts/sidebar'
import { buttonVariants } from '../../ui/button'
import { Sidebar as SidebarIcon } from 'lucide-react'
import Link from 'fumadocs-core/link'
import { usePathname } from 'fumadocs-core/framework'
import { isTabActive } from '../../../lib/is-active'
import type { Option } from '../../root-toggle'

export function Navbar(props: ComponentProps<'header'>) {
  return (
    <header
      {...props}
      className={cn(
        'sticky top-0 z-20 flex flex-col border-b border-fd-border bg-fd-background backdrop-blur supports-[backdrop-filter]:backdrop-blur-xl',
        props.className,
      )}
    >
      {props.children}
    </header>
  )
}

type LayoutBodyProps = ComponentProps<'div'> & {
  sidebar: ReactNode
  navbar: ReactNode
}

export function LayoutBody({ sidebar, navbar, children, className, ...props }: LayoutBodyProps) {
  return (
    <div
      {...props}
      className={cn(
        'relative flex min-h-screen w-full bg-fd-background text-fd-foreground',
        className,
      )}
    >
      {sidebar}
      <div
        className='flex min-h-screen flex-1 flex-col'
        style={{
          marginInlineStart: 'var(--fd-sidebar-width)',
        }}
      >
        {navbar}
        <div className='flex-1 overflow-y-auto px-4 py-6 md:px-10'>{children}</div>
      </div>
    </div>
  )
}

export function NavbarSidebarTrigger({ className, ...props }: ComponentProps<'button'>) {
  const { setOpen } = useSidebar()

  return (
    <button
      {...props}
      className={cn(
        buttonVariants({ color: 'ghost', size: 'icon-sm' }),
        'rounded-full border border-transparent transition-colors hover:border-fd-border',
        className,
      )}
      onClick={() => setOpen((prev) => !prev)}
    >
      <SidebarIcon />
    </button>
  )
}

export function LayoutTabs({ options, ...props }: ComponentProps<'div'> & { options: Option[] }) {
  const pathname = usePathname()
  const selected = useMemo(() => {
    return options.findLast((option) => isTabActive(option, pathname))
  }, [options, pathname])

  return (
    <div
      {...props}
      className={cn(
        'flex flex-row items-center gap-3 overflow-auto px-4 text-sm text-fd-muted-foreground',
        props.className,
      )}
    >
      {options.map((option) => (
        <LayoutTab key={option.url} selected={selected === option} option={option} />
      ))}
    </div>
  )
}

function LayoutTab({ option: { title, url, unlisted, props }, selected = false }: { option: Option; selected?: boolean }) {
  return (
    <Link
      href={url}
      {...props}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1.5 text-sm font-medium text-fd-muted-foreground transition-colors',
        unlisted && !selected && 'hidden',
        selected
          ? 'bg-fd-accent text-fd-accent-foreground shadow-sm'
          : 'hover:border-fd-border hover:bg-fd-accent hover:text-fd-accent-foreground',
        props?.className,
      )}
    >
      {title}
    </Link>
  )
}
