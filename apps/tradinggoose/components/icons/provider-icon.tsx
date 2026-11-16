'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { resolveProviderLogo } from '@/lib/ui/provider-logos'
import { cn } from '@/lib/utils'

export function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  const { resolvedTheme } = useTheme()
  const { data } = useQuery({
    queryKey: ['provider-icons'],
    queryFn: async (): Promise<Record<string, ReturnType<typeof resolveProviderLogo>>> => {
      const response = await fetch('/api/models/icons')
      if (!response.ok) throw new Error('Provider logos are unavailable')
      return response.json()
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const fallback = resolveProviderLogo({ id: provider, name: provider }, [])
  const resolved = data?.[provider] ?? fallback
  const src = resolvedTheme === 'dark' ? (resolved.darkSrc ?? resolved.src) : resolved.src
  const logo = failedSrc === src ? fallback : { ...resolved, src }

  return (
    <img
      src={logo.src}
      alt=''
      width={16}
      height={16}
      loading='lazy'
      decoding='async'
      className={cn('size-4 shrink-0 object-contain', logo.monochrome && 'dark:invert', className)}
      onError={logo.src === fallback.src ? undefined : () => setFailedSrc(logo.src)}
    />
  )
}
