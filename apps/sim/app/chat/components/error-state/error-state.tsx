'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'
import Nav from '@/app/(landing)/components/nav/nav'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'

interface ChatErrorStateProps {
  error: string
  starCount: string
}

export function ChatErrorState({ error, starCount }: ChatErrorStateProps) {
  const router = useRouter()
  const brandConfig = useBrandConfig()
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  return (
    <div className='min-h-screen '>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            {/* Error content */}
            <div className='space-y-1 text-center'>
              <h1
                className={`${soehne.className} font-medium text-[32px] tracking-tight`}
              >
                Chat Unavailable
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {error}
              </p>
            </div>

            {/* Action button - matching login form */}
            <div className='mt-8 w-full'>
              <Button
                type='button'
                onClick={() => router.push('/workspace')}
                className={primaryButtonClasses}
              >
                Return to Workspace
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div
        className={`${inter.className} auth-text-muted fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
      >
        Need help?{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='auth-link underline-offset-4 transition hover:underline'
        >
          Contact support
        </a>
      </div>
    </div>
  )
}
