'use client'

import type React from 'react'
import { ChartCandlestick, LayoutDashboardIcon, Workflow } from 'lucide-react'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { Card } from '@/components/ui/card'
import { MotionPreset } from '@/components/ui/motion-preset'
import { cn } from '@/lib/utils'
import { useCardGlow } from '@/app/(landing)/components/use-card-glow'
import { LayoutPreview } from './components/layout-preview/layout-preview'
import { MarketPreview } from './components/market-preview/market-preview'
import { WorkflowPreview } from './components/workflow-preview/workflow-preview'

type FeatureBullet = {
  title: string
}

type FeatureRow = {
  badge: string
  title: string
  description: string
  bullets: FeatureBullet[]
  preview: React.ReactNode
  previewSide: 'left' | 'right'
  icon: React.ReactNode
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    badge: 'Workspace',
    title: 'Widget layouts',
    description:
      'Split the workspace to place widgets side by side or stacked. Save and switch between named layouts per workspace.',
    bullets: [
      { title: 'Recursive splitting' },
      { title: 'Saved layouts per workspace' },
      { title: 'Shared widget action menu' },
    ],
    preview: <LayoutPreview />,
    previewSide: 'left',
    icon: <LayoutDashboardIcon className='size-5' />,
  },
  {
    badge: 'Charting',
    title: 'Indicators and live data',
    description:
      'Built-in indicators and a PineTS editor for writing custom ones. Connect your own data provider and monitor prices in real time.',
    bullets: [
      { title: 'Configurable indicator inputs' },
      { title: 'Live re-execution per bar' },
      { title: 'Crosshair legend and chart markers' },
    ],
    preview: <MarketPreview />,
    previewSide: 'right',
    icon: <ChartCandlestick className='size-5' />,
  },
  {
    badge: 'Workflows',
    title: 'AI-powered workflows',
    description:
      'Build workflows on a canvas with AI agent blocks that make LLM-driven decisions. Integrate with Slack, Discord, GitHub, Gmail, and more — then route orders to Alpaca, Tradier, or Robinhood.',
    bullets: [
      { title: 'AI agent blocks for autonomous analysis and decisions' },
      { title: 'Integrations with Slack, Discord, GitHub, Gmail, and more' },
      { title: 'Data, condition, loop, parallel, and trading action blocks' },
    ],
    preview: <WorkflowPreview />,
    previewSide: 'left',
    icon: <Workflow className='size-5' />,
  },
]

function FeaturePoint({ title }: FeatureBullet) {
  return (
    <div className='flex items-center gap-3'>
      <span className='h-px w-4 shrink-0 bg-primary' />
      <p className='text-muted-foreground text-sm'>{title}</p>
    </div>
  )
}

function FeatureRowSection({
  badge,
  title,
  description,
  bullets,
  preview,
  previewSide,
  icon,
  index,
}: FeatureRow & { index: number }) {
  const previewIsLeft = previewSide === 'left'
  const contentOrder = previewIsLeft ? 'order-1 lg:order-2' : 'order-1 lg:order-1'
  const previewOrder = previewIsLeft ? 'order-2 lg:order-1' : 'order-2 lg:order-2'
  const contentSlideDirection = previewIsLeft ? 'right' : 'left'
  const previewSlideDirection = previewIsLeft ? 'left' : 'right'

  return (
    <div className='grid items-start gap-4 lg:h-[70vh] lg:min-h-[50vh] lg:grid-cols-5 lg:gap-6 xl:gap-10'>
      <MotionPreset
        fade
        slide={{ direction: contentSlideDirection, offset: 48 }}
        transition={{ duration: 0.6 }}
        delay={index * 0.12}
        className={cn(
          'card group group/feature relative isolate m-1 overflow-hidden rounded-xl bg-foreground/10 p-px transition-all duration-300 ease-in-out lg:col-span-2',
          contentOrder
        )}
      >
        <div
          className='blob absolute top-0 left-0 h-[120px] w-[120px] rounded-full opacity-0 blur-xl transition-all duration-300 ease-in-out'
          style={{ backgroundColor: 'hsl(var(--primary) / 0.7)' }}
        />
        <div
          className='fake-blob absolute top-0 left-0 h-40 w-40 rounded-full'
          style={{ visibility: 'hidden' }}
        />
        <Card className='relative flex h-full min-h-0 flex-col justify-between gap-10 overflow-hidden rounded-xl border p-6 shadow-none transition-all duration-300 ease-in-out'>
          <div
            className='pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100'
            style={{
              background:
                'radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), hsl(var(--primary) / 0.06), transparent 40%)',
            }}
          />
          <div className='relative z-10 space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='flex size-11 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-foreground shadow-sm'>
                {icon}
              </div>
              <p className='font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.24em]'>
                {badge}
              </p>
            </div>

            <h3 className='font-semibold text-2xl text-foreground tracking-tight sm:text-3xl'>
              {title}
            </h3>

            <p className='max-w-xl text-base text-muted-foreground leading-7'>{description}</p>
          </div>

          <div className='relative z-10 space-y-3.5'>
            {bullets.map((bullet, bulletIndex) => (
              <MotionPreset
                key={bullet.title}
                fade
                slide={{ direction: contentSlideDirection, offset: 28 }}
                transition={{ duration: 0.45 }}
                delay={index * 0.12 + 0.2 + bulletIndex * 0.12}
              >
                <FeaturePoint {...bullet} />
              </MotionPreset>
            ))}
          </div>
        </Card>
      </MotionPreset>

      <MotionPreset
        fade
        slide={{ direction: previewSlideDirection, offset: 56 }}
        transition={{ duration: 0.75 }}
        delay={index * 0.12 + 0.15}
        className={cn(
          'flex min-h-[40vh] w-full lg:col-span-3 lg:h-full lg:min-h-0',
          previewOrder,
          previewIsLeft ? 'lg:justify-start' : 'lg:justify-end'
        )}
      >
        <div className='h-full min-h-0 w-full max-w-none'>{preview}</div>
      </MotionPreset>
    </div>
  )
}

export default function Feature() {
  useCardGlow()

  return (
    <section
      id='feature'
      className='relative isolate w-full overflow-hidden py-20 sm:py-28'
      aria-label='Feature'
    >
      <div
        className='pointer-events-none absolute inset-0 z-[-1]'
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent, black 40%, black 60%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent, black 40%, black 60%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'destination-in',
        }}
      >
        <BackgroundRippleEffect
          cellSize={90}
          rows={60}
          cols={27}
          maskClassName=''
          interactive={false}
        />
      </div>

      <div className='mx-auto px-12 sm:px-6 lg:px-20 xl:px-24'>
        <div className='mx-auto max-w-3xl text-center'>
          <MotionPreset
            fade
            slide
            component='p'
            className='font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]'
          >
            Features
          </MotionPreset>
          <MotionPreset
            fade
            slide
            component='h2'
            delay={0.12}
            className='mt-5 font-semibold text-3xl text-foreground tracking-tight sm:text-5xl'
          >
            Your workspace, your way
          </MotionPreset>
          <MotionPreset
            fade
            slide
            component='p'
            delay={0.24}
            className='mx-auto mt-4 max-w-2xl text-lg text-muted-foreground leading-8'
          >
            Layouts, charts, and workflows — each designed to work on its own or together.
          </MotionPreset>
        </div>

        <div className='mt-24 space-y-24 lg:mt-32 lg:space-y-56'>
          {FEATURE_ROWS.map((row, index) => (
            <FeatureRowSection key={row.title} {...row} index={index} />
          ))}
        </div>
      </div>
    </section>
  )
}
