'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

export default function NotFound() {
  const brandConfig = useBrandConfig()
  const router = useRouter()
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
              <h1
                className={`${soehne.className} font-medium text-[32px] tracking-tight`}
              >
                Page Not Found
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                The page you’re looking for doesn’t exist or has been moved.
              </p>
            </div>

            <div className='mt-8 w-full space-y-3'>
              <Button
                type='button'
                onClick={() => router.push('/')}
                className={primaryButtonClasses}
              >
                Return to Home
              </Button>
            </div>

            <div
              className={`${inter.className} text-muted-foreground fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
            >
              Need help?{' '}
              <a
                href={`mailto:${brandConfig.supportEmail}`}
                className='hover:text-primary underline underline-offset-4'
              >
                Contact support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
