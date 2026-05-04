'use client'

import { TimerOff } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui'
import { isProd } from '@/lib/environment'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { FilterSection, FolderFilter, Level, Timeline, Trigger, Workflow } from './components'

/**
 * Filters component for logs page - includes timeline and other filter options
 */
export function Filters() {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.logs.dashboard.filters
  const { data: subscriptionData, isLoading } = useSubscriptionData()
  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const subscription = getSubscriptionStatus(billingPayload)
  const isPaid = subscription.isPaid
  const retentionDays = subscription.tier.logRetentionDays
  const hasFiniteRetention = typeof retentionDays === 'number' && retentionDays > 0

  const handleUpgradeClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const event = new CustomEvent('open-settings', {
      detail: { tab: 'subscription' },
    })
    window.dispatchEvent(event)
  }

  return (
    <div className='h-full w-60 overflow-auto border-r p-4'>
      {!isLoading && hasFiniteRetention && isProd && (
        <div className='mb-4 overflow-hidden rounded-md border border-border'>
          <div className='flex items-center gap-2 border-b bg-background p-3'>
            <TimerOff className='h-4 w-4 text-muted-foreground' />
            <span className='font-medium text-sm'>{copy.retentionPolicy}</span>
          </div>
          <div className='p-3'>
            <p className='text-muted-foreground text-xs'>
              {formatTemplate(copy.retentionDescription, { days: retentionDays })}
            </p>
            {!isPaid ? (
              <div className='mt-2.5'>
                <Button
                  size='sm'
                  variant='secondary'
                  className='h-8 w-full px-3 py-1.5 text-xs'
                  onClick={handleUpgradeClick}
                >
                  {copy.upgradePlan}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <h2 className='mb-4 pl-2 font-medium text-sm'>{copy.title}</h2>

      {/* Level Filter */}
      <FilterSection title={copy.level} content={<Level />} />

      {/* Workflow Filter */}
      <FilterSection title={copy.workflow} content={<Workflow />} />

      {/* Folder Filter */}
      <FilterSection title={copy.folder} content={<FolderFilter />} />

      {/* Trigger Filter */}
      <FilterSection title={copy.trigger} content={<Trigger />} />

      {/* Timeline Filter */}
      <FilterSection title={copy.timeline} content={<Timeline />} />
    </div>
  )
}
