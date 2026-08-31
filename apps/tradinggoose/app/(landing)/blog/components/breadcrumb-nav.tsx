'use client'

import { Home } from 'lucide-react'
import { useMessages } from 'next-intl'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Link } from '@/i18n/navigation'

interface BreadcrumbNavProps {
  pageTitle: string
}

export default function BreadcrumbNav({ pageTitle }: Readonly<BreadcrumbNavProps>) {
  const copy = useMessages()
  const blogCopy = copy.blog

  return (
    <Breadcrumb className='mb-6'>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink
            render={
              <Link href='/' aria-label={blogCopy.home} className='flex items-center gap-2' />
            }
          >
            <Home className='h-4 w-4' /> {blogCopy.home}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href='/blog' aria-label={blogCopy.breadcrumbBlog} />}>
            {blogCopy.breadcrumbBlog}
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  )
}
