'use client'

import { DiscordIcon } from '@/components/icons/icons'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { Button } from '@/components/ui/button'
import { useMessages } from 'next-intl'

export default function CallToAction() {
  const copy = useMessages()

  return (
    <section className='px-4 py-16 md:py-24'>
      <div className='relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border bg-card py-8 shadow-sm md:py-10 dark:bg-card/50'>
        <div
          className='pointer-events-none absolute inset-0 z-0'
          style={{
            maskImage:
              'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
            maskComposite: 'intersect',
            WebkitMaskComposite: 'destination-in',
          }}
        >
          <BackgroundRippleEffect cellSize={60} rows={12} cols={20} maskClassName='' interactive />
        </div>
        <div className='relative z-10 flex flex-col gap-y-6 px-4'>
          <div className='space-y-2'>
            <h2 className='text-center font-semibold text-lg tracking-tight md:text-2xl'>
              {copy.landing.cta.title}
            </h2>
            <p className='text-balance text-center text-muted-foreground text-sm md:text-base'>
              {copy.landing.cta.description}
            </p>
          </div>
          <div className='flex items-center justify-center'>
            <Button variant='outline' className='bg-background' asChild>
              <a href='https://discord.gg/wavf5JWhuT' target='_blank' rel='noopener noreferrer'>
                <DiscordIcon className='size-4' />
                {copy.landing.cta.joinDiscord}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
