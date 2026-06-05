'use client'

import { Button } from '@/components/ui/button'
import { useBrandConfig } from '@/lib/branding/branding'
import Nav from '@/app/(landing)/components/nav/nav'
import type { Messages } from 'next-intl'

type ChatMessages = Messages['chat']
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import { useRouter } from '@/i18n/navigation'

interface ChatErrorStateProps {
  error: string
  starCount: string
  copy: ChatMessages
}

export function ChatErrorState({ error, copy }: ChatErrorStateProps) {
  const router = useRouter()
  const brandConfig = useBrandConfig()
  const primaryButtonClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  return (
    <div className='min-h-screen'>
      <Nav variant='auth' />
      <div className='flex min-h-[calc(100vh-120px)] items-center justify-center px-4'>
        <div className='w-full max-w-[410px]'>
          <div className='flex flex-col items-center justify-center'>
            <div className='space-y-1 text-center'>
              <h1 className={`${soehne.className} font-medium text-[32px] tracking-tight`}>
                {copy.error.title}
              </h1>
              <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                {error}
              </p>
            </div>

            <div className='mt-8 w-full'>
              <Button
                type='button'
                onClick={() => router.push('/workspace')}
                className={primaryButtonClasses}
              >
                {copy.error.returnToWorkspace}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div
        className={`${inter.className} text-muted-foreground fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
      >
        {copy.error.needHelp}{' '}
        <a
          href={`mailto:${brandConfig.supportEmail}`}
          className='hover:text-primary underline underline-offset-4'
        >
          {copy.error.contactSupport}
        </a>
      </div>
    </div>
  )
}
