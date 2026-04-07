'use client'

import { Separator } from '@/components/ui/separator'

interface PageHeadingProps {
  title: string
  description?: string
}

export default function PageHeading({ title, description }: PageHeadingProps) {
  return (
    <div className="space-y-1">
      <h1 className="inline-block text-2xl font-bold tracking-tight md:text-3xl lg:text-4xl">
        {title}
      </h1>
      {description && <p className="text-base text-muted-foreground md:text-lg">{description}</p>}
      <Separator className="my-6 md:my-4" />
    </div>
  )
}
