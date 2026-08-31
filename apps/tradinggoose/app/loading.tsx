'use client'

import { Loader2 } from 'lucide-react'
import { useMessages } from 'next-intl'

export default function Loading() {
  const label = useMessages().auth.common.loading

  return (
    <main
      role='status'
      aria-live='polite'
      aria-busy='true'
      className='flex min-h-svh items-center justify-center gap-2 bg-background text-muted-foreground text-sm'
    >
      <Loader2 aria-hidden='true' className='size-4 animate-spin motion-reduce:animate-none' />
      <span>{label}</span>
    </main>
  )
}
