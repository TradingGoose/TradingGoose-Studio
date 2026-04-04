'use client'

import { useState } from 'react'
import { CreditCardIcon } from 'lucide-react'
import { DiscordIcon } from '@/components/icons/icons'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function CallToAction() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || status === 'loading') return

    setStatus('loading')
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.ok) {
        setStatus('success')
        setMessage('Subscribed! Check your inbox.')
        setEmail('')
      } else {
        const data = await res.json()
        setStatus('error')
        setMessage(data.error || 'Something went wrong.')
      }
    } catch {
      setStatus('error')
      setMessage('Something went wrong.')
    }
  }

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
              See what the commutity is building with TradingGoose.
            </p>
          </div>
          <div className='flex items-center justify-center'>
            <Button variant='outline' className='bg-background' asChild>
              <a href='https://discord.gg/wavf5JWhuT' target='_blank' rel='noopener noreferrer'>
                <DiscordIcon className='size-4' />
                Join Discord
              </a>
            </Button>
          </div>
          {status === 'success' ? (
            <p className='text-center text-sm text-emerald-500'>{message}</p>
          ) : (
            <form onSubmit={handleSubscribe} className='mx-auto flex w-full max-w-sm gap-2'>
              <Input
                type='email'
                required
                placeholder='you@example.com'
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (status === 'error') setStatus('idle')
                }}
                className='h-9 bg-background'
              />
              <Button type='submit' size='sm' disabled={status === 'loading'} className='h-9 shrink-0'>
                {status === 'loading' ? 'Subscribing...' : 'Get updates'}
              </Button>
            </form>
          )}
          {status === 'error' && (
            <p className='text-center text-xs text-red-500'>{message}</p>
          )}
        </div>
      </div>
    </section>
  )
}
