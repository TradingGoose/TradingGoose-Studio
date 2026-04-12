'use client'

import { CircleIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { MotionPreset } from '@/components/ui/motion-preset'
import { formatBillingPriceLabel, formatBillingPricePeriod } from '@/lib/billing/public-catalog'
import {
  DEFAULT_REGISTRATION_MODE,
  getRegistrationPrimaryHref,
  getRegistrationPrimaryLabel,
} from '@/lib/registration/shared'
import { cn } from '@/lib/utils'
import { useCardGlow } from '@/app/(landing)/components/use-card-glow'
import { toPlanFeatures } from '@/global-navbar/settings-modal/components/subscription/plan-configs'
import { usePublicBillingCatalog } from '@/hooks/queries/public-billing-catalog'
import { useRegistrationState } from '@/hooks/queries/registration'

interface PricingTierCard {
  id: string
  name: string
  price: string
  period?: string
  description: string
  features: ReturnType<typeof toPlanFeatures>
  featured?: boolean
  ctaKind: 'contact' | 'signup'
  contactUrl?: string | null
}

export default function LandingPricing() {
  const router = useRouter()
  const registrationQuery = useRegistrationState()
  const registrationMode = registrationQuery.data?.registrationMode ?? DEFAULT_REGISTRATION_MODE
  const { data: publicBillingCatalog } = usePublicBillingCatalog()
  const featuredTierId =
    publicBillingCatalog?.publicTiers.find((tier) => !tier.isDefault)?.id ?? null

  useCardGlow()

  const publicTierCards =
    publicBillingCatalog?.publicTiers.map((tier) => ({
      id: tier.id,
      name: tier.displayName,
      price: formatBillingPriceLabel(tier),
      period: formatBillingPricePeriod(tier) ?? undefined,
      description: tier.description,
      features: toPlanFeatures(tier.pricingFeatures),
      featured: tier.id === featuredTierId,
      ctaKind: 'signup' as const,
    })) ?? []

  const pricingTiers: PricingTierCard[] = [
    ...publicTierCards,
    ...(publicBillingCatalog?.enterprisePlaceholder
      ? [
          {
            id: 'enterprise-placeholder',
            name: publicBillingCatalog.enterprisePlaceholder.displayName,
            price: 'Custom',
            description: publicBillingCatalog.enterprisePlaceholder.description,
            features: toPlanFeatures(publicBillingCatalog.enterprisePlaceholder.pricingFeatures),
            ctaKind: 'contact' as const,
            contactUrl: publicBillingCatalog.enterprisePlaceholder.contactUrl,
          },
        ]
      : []),
  ]

  if (!publicBillingCatalog?.billingEnabled || pricingTiers.length === 0) {
    return null
  }

  const handleCta = (tier: PricingTierCard) => {
    if (tier.ctaKind === 'contact') {
      if (!tier.contactUrl) {
        return
      }

      window.open(tier.contactUrl, '_blank')
      return
    }

    router.push(getRegistrationPrimaryHref(registrationMode))
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
            Pick a plan, start building.
          </MotionPreset>
          <MotionPreset
            fade
            slide
            component='p'
            delay={0.24}
            className='mx-auto mt-4 max-w-2xl text-lg text-muted-foreground leading-8'
          >
            Every plan includes the full platform — workspace, charting, workflows, AI agents, and
            integrations.
          </MotionPreset>
        </div>

        <div className='mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:mt-20 xl:grid-cols-4'>
          {pricingTiers.map((tier, index) => {
            const buttonVariant = tier.featured ? 'default' : 'outline'
            const ctaText =
              tier.ctaKind === 'contact'
                ? 'Contact Sales'
                : getRegistrationPrimaryLabel(registrationMode)

            return (
              <MotionPreset
                key={tier.id}
                fade
                slide={{ direction: 'up', offset: 32 }}
                transition={{ duration: 0.5 }}
                delay={0.1 + index * 0.1}
              >
                <div
                  suppressHydrationWarning
                  className={cn(
                    'card group relative h-full overflow-hidden rounded-lg bg-foreground/10 p-px transition-all duration-300 ease-in-out',
                    { 'p-0': tier.featured }
                  )}
                >
                  <div
                    suppressHydrationWarning
                    className='blob absolute top-0 left-0 h-[120px] w-[120px] rounded-full opacity-0 blur-xl transition-all duration-300 ease-in-out'
                    style={{ backgroundColor: 'hsl(var(--primary) / 0.7)' }}
                  />
                  <div
                    className='fake-blob absolute top-0 left-0 h-40 w-40 rounded-full'
                    style={{ visibility: 'hidden' }}
                  />
                  <Card
                    className={cn(
                      'relative flex h-full flex-col gap-6 overflow-hidden rounded-lg border py-6 shadow-none transition-all duration-300 ease-in-out',
                      { 'border-2 border-primary': tier.featured }
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
                        <h3 className='font-semibold text-3xl'>{tier.name}</h3>
                        <div className='flex gap-0.5'>
                          {tier.price !== 'Free' && tier.price !== 'Custom' && (
                            <span className='font-medium text-lg text-muted-foreground'>$</span>
                          )}
                          <span className='font-bold text-6xl'>
                            {tier.price === 'Free' || tier.price === 'Custom'
                              ? tier.price
                              : tier.price.replace('$', '')}
                          </span>
                          {tier.period && (
                            <span className='self-end font-normal text-lg text-muted-foreground'>
                              {tier.period}
                            </span>
                          )}
                        </div>
                        <p className='font-normal text-base'>{tier.description}</p>
                      </div>

                      <Button
                        size='lg'
                        className='border-primary'
                        variant={buttonVariant}
                        onClick={() => handleCta(tier)}
                      >
                        {ctaText}
                      </Button>

                      <div className='flex flex-col gap-1.5'>
                        {tier.features.map((feature, featureIndex) => (
                          <div
                            key={`${tier.id}-${feature.text}-${featureIndex}`}
                            className='flex items-center gap-2 py-1'
                          >
                            <CircleIcon className='size-3' />
                            <span className='font-normal text-base'>{feature.text}</span>
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
