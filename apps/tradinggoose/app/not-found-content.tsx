'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import { useAppMessages } from '@/i18n/client-messages'
import { useRouter } from '@/i18n/navigation'

export default function NotFoundContent() {
  const brandConfig = useBrandConfig()
  const router = useRouter()
  const copy = useAppMessages()
  const notFoundCopy = copy.notFound
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  useEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    const hadLight = root.classList.contains('light')
    root.classList.add('light')
    root.classList.remove('dark')
    return () => {
      if (!hadLight) root.classList.remove('light')
      if (hadDark) root.classList.add('dark')
    }
  }, [])

  return (
    <div className='min-h-screen '>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            <div className='space-y-1 text-center'>
              <h1 className={`${soehne.className} font-medium text-[32px] tracking-tight`}>
                {notFoundCopy.title}
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {notFoundCopy.description}
              </p>
            </div>

            <div className='mt-8 w-full space-y-3'>
              <Button
                type='button'
                onClick={() => router.push('/')}
                className={primaryButtonClasses}
              >
                {notFoundCopy.returnHome}
              </Button>
            </div>

            <div
              className={`${inter.className} text-muted-foreground fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
            >
              {notFoundCopy.supportPrefix}{' '}
              <a
                href={`mailto:${brandConfig.supportEmail}`}
                className='hover:text-primary underline underline-offset-4'
              >
                {notFoundCopy.supportLinkLabel}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
