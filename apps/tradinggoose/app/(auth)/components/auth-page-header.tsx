import type { ReactNode } from 'react'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

interface AuthPageHeaderProps {
  eyebrow: string
  title: ReactNode
  description: ReactNode
}

export function AuthPageHeader({ eyebrow, title, description }: AuthPageHeaderProps) {
  return (
    <div className='space-y-2 text-center'>
      <p className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]'>
        {eyebrow}
      </p>
      <h1 className={`${soehne.className} font-medium text-[32px] tracking-tight`}>{title}</h1>
      <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
        {description}
      </p>
    </div>
  )
}
