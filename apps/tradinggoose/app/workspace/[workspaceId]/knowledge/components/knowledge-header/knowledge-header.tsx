'use client'

import { LibraryBig } from 'lucide-react'
import Link from 'next/link'
import { GlobalNavbarHeader } from '@/global-navbar'

interface BreadcrumbItem {
  label: string
  href?: string
  id?: string
}

const HEADER_STYLES = {
  breadcrumbsWrapper: 'hidden items-center gap-2 sm:flex',
  icon: 'h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70',
  link: 'group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground',
  label: 'font-medium text-sm',
  separator: 'text-muted-foreground',
} as const

interface KnowledgeHeaderProps {
  breadcrumbs: BreadcrumbItem[]
  centerContent?: React.ReactNode
}

export function KnowledgeHeader({ breadcrumbs, centerContent }: KnowledgeHeaderProps) {
  const breadcrumbContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className={HEADER_STYLES.breadcrumbsWrapper}>
        {breadcrumbs.map((breadcrumb, index) => {
          const key = breadcrumb.id || `${breadcrumb.label}-${breadcrumb.href || index}`

          return (
            <div key={key} className='flex items-center gap-2'>
              {index === 0 && <LibraryBig className={HEADER_STYLES.icon} />}

              {breadcrumb.href ? (
                <Link href={breadcrumb.href} prefetch={true} className={HEADER_STYLES.link}>
                  <span>{breadcrumb.label}</span>
                </Link>
              ) : (
                <span className={HEADER_STYLES.label}>{breadcrumb.label}</span>
              )}

              {index < breadcrumbs.length - 1 && <span className={HEADER_STYLES.separator}>/</span>}
            </div>
          )
        })}
      </div>

      {/* Show compact breadcrumb text on small screens */}
      <div className='flex flex-1 items-center gap-1 text-muted-foreground text-sm sm:hidden'>
        <LibraryBig className='h-[16px] w-[16px]' />
        <span className='truncate'>
          {breadcrumbs[breadcrumbs.length - 1]?.label ?? 'Knowledge'}
        </span>
      </div>
    </div>
  )

  return (
    <GlobalNavbarHeader left={breadcrumbContent} center={centerContent} />
  )
}
