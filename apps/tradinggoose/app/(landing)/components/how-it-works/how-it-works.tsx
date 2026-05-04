import { BotMessageSquareIcon, ChartCandlestick, DatabaseIcon, Workflow } from 'lucide-react'
import { getLocale } from 'next-intl/server'

import ProcessFlow from '@/app/(landing)/components/how-it-works/process-flow'
import type { Process } from '@/app/(landing)/components/how-it-works/process-flow'
import { MotionPreset } from '@/components/ui/motion-preset'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

const PROCESS_ICONS = [DatabaseIcon, ChartCandlestick, BotMessageSquareIcon, Workflow]

export default async function HowItWorks() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const processes: Process[] = copy.landing.howItWorks.processes.map((process, index) => {
    const Icon = PROCESS_ICONS[index] ?? Workflow

    return {
      id: String(index + 1),
      icon: <Icon />,
      title: process.title,
      description: process.description,
    }
  })

  return (
    <section className='py-8 mt-24 sm:mt-32 sm:py-16 lg:mt-60 lg:py-24'>
      <div className='mx-auto px-4 sm:px-6 lg:px-24'>
        <div className='grid grid-cols-1 gap-12 lg:grid-cols-2 xl:gap-16'>
          {/* Left content */}
          <div className='space-y-4'>
            <MotionPreset
              fade
              blur
              slide={{ direction: 'down', offset: 50 }}
              transition={{ duration: 0.5 }}
              component='p'
              className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]'
            >
              {copy.landing.howItWorks.eyebrow}
            </MotionPreset>
            <MotionPreset
              component='h2'
              className='text-2xl font-semibold md:text-3xl lg:text-4xl'
              fade
              blur
              slide={{ direction: 'down', offset: 50 }}
              delay={0.15}
              transition={{ duration: 0.5 }}
            >
              {copy.landing.howItWorks.title}
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
              {copy.landing.howItWorks.description}
            </MotionPreset>
          </div>

          {/* Right content — stacked card carousel */}
          <MotionPreset fade blur transition={{ duration: 0.7 }} className='h-96 sm:h-80'>
            <ProcessFlow initialProcess={processes} />
          </MotionPreset>
        </div>
      </div>
    </section>
  )
}
