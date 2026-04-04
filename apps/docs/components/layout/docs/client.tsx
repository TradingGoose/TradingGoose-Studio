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
import { useTreeContext, useTreePath } from 'fumadocs-ui/contexts/tree'
import type * as PageTree from 'fumadocs-core/page-tree'
import {
  findFolderPathBySegments,
  getFolderHref,
  getFolderSlug,
  getPageSlug,
  humanizeSlug,
  supportedLanguages,
} from '@/lib/page-tree'

export function Navbar(props: ComponentProps<'header'>) {
  return (
    <header
      {...props}
      className={cn(
        'sticky top-0 z-20 flex flex-col border-b border-fd-border bg-fd-background/40 backdrop-blur supports-[backdrop-filter]:backdrop-blur-sm',
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
        'relative flex min-h-screen w-full text-fd-foreground',
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

type DocsBreadcrumbProps = {
  icon?: ReactNode
  label: ReactNode
  href?: string
  className?: string
}

export function DocsBreadcrumb({ icon, label, href = '/', className }: DocsBreadcrumbProps) {
  const { root } = useTreeContext()
  const path = useTreePath() ?? []
  const pathname = usePathname()

  const slugSegments = useMemo(() => getSlugSegments(pathname), [pathname])

  const nodes = useMemo(() => {
    const filtered = path.filter(
      (node): node is Exclude<PageTree.Node, PageTree.Separator> =>
        node.type === 'folder' || node.type === 'page',
    )

    if (filtered.length > 0) return filtered
    if (slugSegments.length === 0) return []

    const fallback = findFolderPathBySegments(root, slugSegments)
    return fallback ?? []
  }, [path, root, slugSegments])

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1 text-xs text-fd-muted-foreground',
        className,
      )}
    >
      <Link href={href} className='flex shrink-0 items-center gap-2 text-sm text-fd-foreground font-medium'>
        {icon}
        <span className='truncate'>{label}</span>
      </Link>
      {nodes.map((node, index) => {
        const isLast = index === nodes.length - 1
        const href = node.type === 'page' ? node.url : getFolderHref(node)
        const label = renderNodeLabel(node)

        return (
          <div key={nodeKey(node, index)} className='flex min-w-0 items-center gap-1'>
            <span className='text-fd-border'>/</span>
            {href && !isLast ? (
              <Link
                href={href}
                className='truncate text-xs text-fd-muted-foreground transition-colors hover:text-fd-foreground'
              >
                {label}
              </Link>
            ) : (
              <span className='truncate text-xs text-fd-muted-foreground'>{label}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function renderNodeLabel(node: Exclude<PageTree.Node, PageTree.Separator>) {
  if (typeof node.name === 'string' && node.name.trim().length > 0) {
    return node.name
  }

  if (node.type === 'folder') {
    const slug = getFolderSlug(node)
    if (slug) return humanizeSlug(slug)
  }

  if (node.type === 'page') {
    const slug = getPageSlug(node)
    if (slug) return humanizeSlug(slug)
  }

  return node.name ?? 'Untitled'
}

function nodeKey(node: Exclude<PageTree.Node, PageTree.Separator>, index: number) {
  if (node.$id) return `${node.$id}-${index}`
  if (node.type === 'page') return `${node.url}-${index}`
  const slug = node.type === 'folder' ? getFolderSlug(node) : undefined
  if (slug) return `${slug}-${index}`
  return `crumb-${index}`
}

function getSlugSegments(pathname: string) {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) return parts

  if (supportedLanguages.includes(parts[0] as (typeof supportedLanguages)[number])) {
    return parts.slice(1)
  }

  return parts
}
