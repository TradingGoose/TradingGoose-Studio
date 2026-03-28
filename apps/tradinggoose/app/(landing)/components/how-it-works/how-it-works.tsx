import { ArrowRightIcon, DatabaseIcon, ChartCandlestick, BotMessageSquareIcon, Workflow } from 'lucide-react'

import ProcessFlow from '@/app/(landing)/components/how-it-works/process-flow'
import type { Process } from '@/app/(landing)/components/how-it-works/process-flow'

import { Button } from '@/components/ui/button'
import { MotionPreset } from '@/components/ui/motion-preset'

const processes: Process[] = [
  {
    id: '1',
    icon: <DatabaseIcon />,
    title: 'Connect your data',
    description:
      'Plug in any market data provider and stream live prices into the workspace.',
  },
  {
    id: '2',
    icon: <ChartCandlestick />,
    title: 'Monitor with indicators',
    description:
      'Write custom PineTS indicators that watch for the conditions you care about.',
  },
  {
    id: '3',
    icon: <BotMessageSquareIcon />,
    title: 'Analyze with AI agents',
    description:
      'Let LLM-powered agent blocks evaluate signals, assess risk, and make decisions autonomously.',
  },
  {
    id: '4',
    icon: <Workflow />,
    title: 'Trigger workflows',
    description:
      'When a signal fires, kick off a workflow to trade, alert, log, or anything else you define.',
  },
]

export default function HowItWorks() {
  return (
    <section className='py-8 mt-24 sm:mt-32 sm:py-16 lg:mt-60 lg:py-24'>
      <div className='mx-auto px-10 sm:px-16 lg:px-24'>
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
              How it works
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
              From data to decision
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
              Connect your own data sources, monitor markets with custom indicators,
              let AI agents analyze what matters, and trigger workflows that act on your behalf.
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
