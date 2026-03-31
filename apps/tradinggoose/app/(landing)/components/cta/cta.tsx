'use client'

import { ArrowRightIcon, CreditCardIcon } from 'lucide-react'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { Button } from '@/components/ui/button'

export default function CallToAction() {
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
              Let AI agents work your trading strategy.
            </h2>
            <p className='text-balance text-center text-muted-foreground text-sm md:text-base'>
              Start building for free. No credit card{' '}
              <CreditCardIcon className='inline-block size-4' /> required.
            </p>
          </div>
          <div className='flex items-center justify-center'>
            <Button className='shadow'>
              Get Started <ArrowRightIcon data-icon='inline-end' />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
