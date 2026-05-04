import { getLocale } from 'next-intl/server'

import { MotionPreset } from '@/components/ui/motion-preset'
import { fetchMonitorStocks } from '@/app/(landing)/components/monitor-preview/fetch-listings'
import MonitorPreview from '@/app/(landing)/components/monitor-preview/monitor-preview'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

export default async function MonitorSection() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const stocks = await fetchMonitorStocks()
  return (
    <section className='py-8 sm:py-16 lg:py-24'>
      <div className='mx-auto px-4 sm:px-6 lg:px-24'>
        <div className='grid grid-cols-1 gap-12 lg:grid-cols-2 xl:gap-16'>
          {/* Left content — animated table */}
          <MotionPreset
            fade
            blur
            transition={{ duration: 0.7 }}
            className='order-2 flex items-center lg:order-1'
          >
            <MonitorPreview stocks={stocks} />
          </MotionPreset>

          {/* Right content */}
          <div className='order-1 space-y-4 lg:order-2'>
            <MotionPreset
              fade
              blur
              slide={{ direction: 'down', offset: 50 }}
              transition={{ duration: 0.5 }}
              component='p'
              className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]'
            >
              {copy.landing.monitorSection.eyebrow}
            </MotionPreset>
            <MotionPreset
              component='h2'
              className='font-semibold text-2xl md:text-3xl lg:text-4xl'
              fade
              blur
              slide={{ direction: 'down', offset: 50 }}
              delay={0.15}
              transition={{ duration: 0.5 }}
            >
              {copy.landing.monitorSection.title}
            </MotionPreset>
            <MotionPreset
              component='p'
              className='text-muted-foreground text-xl'
              fade
              blur
              slide={{ direction: 'down', offset: 50 }}
              delay={0.3}
              transition={{ duration: 0.5 }}
            >
              {copy.landing.monitorSection.description}
            </MotionPreset>

            <div className='space-y-2'>
              {copy.landing.monitorSection.bullets.map((text, i) => (
                <MotionPreset
                  key={text}
                  fade
                  blur
                  slide={{ direction: 'down', offset: 50 }}
                  delay={0.45 + i * 0.1}
                  transition={{ duration: 0.5 }}
                >
                  <div className='flex items-center gap-3'>
                    <span className='h-px w-4 shrink-0 bg-primary' />
                    <p className='text-muted-foreground text-sm'>{text}</p>
                  </div>
                </MotionPreset>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
