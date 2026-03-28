'use client'

import type { LucideIcon } from 'lucide-react'
import {
  CircleIcon,
  Code2,
  Database,
  DollarSign,
  HardDrive,
  Workflow,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MotionPreset } from '@/components/ui/motion-preset'
import { cn } from '@/lib/utils'
import { useCardGlow } from '@/app/(landing)/components/use-card-glow'
import {
  ENTERPRISE_PLAN_FEATURES,
  PRO_PLAN_FEATURES,
  TEAM_PLAN_FEATURES,
} from '@/global-navbar/settings-modal/components/subscription/plan-configs'

interface PricingFeature {
  icon: LucideIcon
  text: string
}

interface PricingTier {
  name: string
  price: string
  period?: string
  description: string
  features: PricingFeature[]
  ctaText: string
  featured?: boolean
}

const pricingTiers: PricingTier[] = [
  {
    name: 'Community',
    price: 'Free',
    description: 'For individuals exploring automated trading workflows and strategy prototyping.',
    features: [
      { icon: DollarSign, text: '$10 usage limit' },
      { icon: HardDrive, text: '5GB file storage' },
      { icon: Workflow, text: 'Public template access' },
      { icon: Database, text: 'Limited log retention' },
      { icon: Code2, text: 'CLI / SDK access' },
    ],
    ctaText: 'Get Started',
  },
  {
    name: 'Pro',
    price: '$20',
    period: '/mo',
    description: 'For active traders who need higher throughput, more storage, and unlimited workspaces.',
    features: PRO_PLAN_FEATURES,
    ctaText: 'Get Started',
    featured: true,
  },
  {
    name: 'Team',
    price: '$40',
    period: '/mo',
    description: 'For teams that share strategies, pooled storage, and need a dedicated support channel.',
    features: TEAM_PLAN_FEATURES,
    ctaText: 'Get Started',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'For organisations with custom rate limits, hosting, and dedicated support requirements.',
    features: ENTERPRISE_PLAN_FEATURES,
    ctaText: 'Contact Sales',
  },
]

export default function LandingPricing() {
  const router = useRouter()

  useCardGlow()

  const handleCta = (tier: PricingTier) => {
    if (tier.ctaText === 'Contact Sales') {
      window.open('https://form.typeform.com/to/jqCO12pF', '_blank')
    } else {
      router.push('/signup')
    }
  }

  return (
    <section id='pricing' className='relative isolate w-full py-20 sm:py-28' aria-label='Pricing'>
      <div className='mx-auto w-full px-4 sm:px-6 lg:px-16 xl:px-20'>
        <div className='mx-auto max-w-3xl text-center'>
          <MotionPreset
            fade
            slide
            component='p'
            className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]'
          >
            Pricing
          </MotionPreset>
          <MotionPreset
            fade
            slide
            component='h2'
            delay={0.12}
            className='mt-5 font-semibold text-3xl text-foreground tracking-tight sm:text-5xl'
          >
            Simple, transparent pricing.
          </MotionPreset>
          <MotionPreset
            fade
            slide
            component='p'
            delay={0.24}
            className='mx-auto mt-4 max-w-2xl text-lg text-muted-foreground leading-8'
          >
            Start free, scale when you need to. Every plan includes the full platform.
          </MotionPreset>
        </div>

        <div className='mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4'>
          {pricingTiers.map((tier, index) => {
            const buttonVariant = tier.featured ? 'default' : 'outline'

            return (
              <MotionPreset
                key={tier.name}
                fade
                slide={{ direction: 'up', offset: 32 }}
                transition={{ duration: 0.5 }}
                delay={0.1 + index * 0.1}
              >
                <div
                  className={cn(
                    'bg-foreground/10 card group relative h-full overflow-hidden rounded-xl p-px transition-all duration-300 ease-in-out max-lg:last:col-span-full',
                    { 'p-0': tier.featured }
                  )}
                >
                  <div
                    className='blob absolute top-0 left-0 h-[120px] w-[120px] rounded-full opacity-0 blur-xl transition-all duration-300 ease-in-out'
                    style={{ backgroundColor: 'hsl(var(--primary) / 0.4)' }}
                  />
                  <div
                    className='fake-blob absolute top-0 left-0 h-40 w-40 rounded-full'
                    style={{ visibility: 'hidden' }}
                  />
                  <Card
                    className={cn(
                      'relative flex h-full flex-col gap-6 overflow-hidden rounded-xl border py-6 shadow-none transition-all duration-300 ease-in-out',
                      { 'border-primary border-2': tier.featured }
                    )}
                  >
                    <div
                      className='pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100'
                      style={{
                        background:
                          'radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), hsl(var(--primary) / 0.06), transparent 40%)',
                      }}
                    />
                    <CardContent className='relative z-10 flex flex-col gap-6'>
                      <div className='flex flex-col gap-6'>
                        <h3 className='text-3xl font-semibold'>{tier.name}</h3>
                        <div className='flex gap-0.5'>
                          {tier.price !== 'Free' && tier.price !== 'Custom' && (
                            <span className='text-muted-foreground text-lg font-medium'>$</span>
                          )}
                          <span className='text-6xl font-bold'>
                            {tier.price === 'Free' || tier.price === 'Custom'
                              ? tier.price
                              : tier.price.replace('$', '')}
                          </span>
                          {tier.period && (
                            <span className='text-muted-foreground self-end text-lg font-normal'>
                              {tier.period}
                            </span>
                          )}
                        </div>
                        <p className='text-base font-normal'>{tier.description}</p>
                      </div>

                      <Button
                        size='lg'
                        className='border-primary'
                        variant={buttonVariant}
                        onClick={() => handleCta(tier)}
                      >
                        {tier.ctaText}
                      </Button>

                      <div className='flex flex-col gap-1.5'>
                        {tier.features.map((feature, idx) => (
                          <div key={idx} className='flex items-center gap-2 py-1'>
                            <CircleIcon className='size-3' />
                            <span className='text-base font-normal'>{feature.text}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </MotionPreset>
            )
          })}
        </div>
      </div>
    </section>
  )
}
