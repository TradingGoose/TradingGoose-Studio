'use client'

import { useRef } from 'react'

import Image from 'next/image'
import {
  ArrowRightIcon,
  BotMessageSquareIcon,
  ChartCandlestick,
  CodeXmlIcon,
  ChartLine,
  Workflow,
  LayoutDashboardIcon,
  ActivityIcon,
  BlocksIcon,
} from 'lucide-react'

import { AnimatedBeam } from '@/components/ui/animated-beam'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WordRotate } from '@/components/ui/word-rotate'

const Hero = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const iconRef1 = useRef<HTMLDivElement>(null)
  const iconRef2 = useRef<HTMLDivElement>(null)
  const iconRef3 = useRef<HTMLDivElement>(null)
  const iconRef4 = useRef<HTMLDivElement>(null)
  const iconRef5 = useRef<HTMLDivElement>(null)
  const iconRef6 = useRef<HTMLDivElement>(null)
  const iconRef7 = useRef<HTMLDivElement>(null)
  const spanRef1 = useRef<HTMLSpanElement>(null)
  const spanRef2 = useRef<HTMLSpanElement>(null)
  const spanRef3 = useRef<HTMLSpanElement>(null)
  const spanRef4 = useRef<HTMLSpanElement>(null)
  const spanRef5 = useRef<HTMLSpanElement>(null)
  const spanRef6 = useRef<HTMLSpanElement>(null)
  const spanRef7 = useRef<HTMLSpanElement>(null)
  const spanRef8 = useRef<HTMLSpanElement>(null)
  return (
    <section className='flex-1 pt-8 sm:pt-16 lg:pt-24'>
      <div className='relative z-10 mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 sm:gap-16 sm:px-6 lg:gap-24 lg:px-8'>
        <div className='flex flex-col items-center gap-4 text-center'>
          <Badge variant='outline' className='relative bg-background z-10 text-sm font-normal'>
            Honk! Introducing TradingGoose Studio 🚀
          </Badge>

          <h1 className='relative z-10 text-2xl font-semibold sm:text-3xl lg:text-5xl lg:font-bold'>
            <WordRotate words={['Build', 'Test', 'Run']} duration={4000} />
            {' '}your{' '}
            <WordRotate
              words={['Trading Analysis', 'Signal Detection', 'Risk Assessment']}
              className='underline underline-offset-3'
              duration={7000}
            />
            {' '}with TradingGoose
          </h1>

          <p className='relative z-10 text-muted-foreground max-w-3xl text-lg leading-relaxed'>
            Connect your own data providers, write custom indicators to monitor market prices,
            and wire them into workflows that trigger trade, sell, buy, or any action you define.
          </p>

          <p className='relative z-10 max-w-3xl text-balance text-muted-foreground text-sm leading-relaxed'>
            TradingGoose Studio is built for analytics, charting, monitoring, and workflow
            automation. You remain solely responsible for any live trading decisions, orders, and
            resulting gains or losses.
          </p>

          <div className='relative z-10 flex flex-wrap items-center justify-center gap-2'>
            <Badge variant='secondary' className='gap-1.5 px-3 py-1 text-xs font-normal'>
              <BotMessageSquareIcon className='size-3.5' />
              AI Agent Workflows
            </Badge>
            <Badge variant='secondary' className='gap-1.5 px-3 py-1 text-xs font-normal'>
              <ChartCandlestick className='size-3.5' />
              Custom Indicators
            </Badge>
            <Badge variant='secondary' className='gap-1.5 px-3 py-1 text-xs font-normal'>
              <ActivityIcon className='size-3.5' />
              Bring Your Own Data
            </Badge>
            <Badge variant='secondary' className='gap-1.5 px-3 py-1 text-xs font-normal'>
              <BlocksIcon className='size-3.5' />
              Integrations
            </Badge>
          </div>

          <div className='relative z-10 mt-4 flex flex-wrap items-center gap-4'>
            <Button
              size='sm'
              className='group relative w-fit overflow-hidden rounded-md px-6 font-bold shadow-md bg-primary text-black hover:bg-primary-hover'
              asChild
            >
              <a href='#'>
                Get started <ArrowRightIcon className='transition-transform duration-200 group-hover:translate-x-0.5' />
              </a>
            </Button>
            <Button size='sm' asChild className='rounded-md px-6 text-base bg-secondary text-secondary-foreground hover:bg-secondary/50 shadow-md'>
              <a href='#'>Learn more</a>
            </Button>
          </div>

        </div>

        <div ref={containerRef} className='relative z-10 flex w-full flex-col items-center'>
          <div className='flex w-full max-w-4xl items-center justify-between'>
            <div className='flex items-center gap-6 sm:gap-10 md:gap-[7.5rem]'>
              <div
                ref={iconRef1}
                className='bg-background flex size-12 items-center justify-center rounded-xl border-[1.5px] shadow-md lg:size-[3.75rem]'
              >
                <ChartCandlestick className='size-7 stroke-1 lg:size-10' />
              </div>
              <span ref={spanRef1} className='size-0.5' />
            </div>
            <div className='flex items-center gap-6 sm:gap-10 md:gap-[7.5rem]'>
              <span ref={spanRef2} className='size-0.5' />
              <div
                ref={iconRef2}
                className='bg-background flex size-12 items-center justify-center rounded-xl border-[1.5px] shadow-md lg:size-[3.75rem]'
              >
                <LayoutDashboardIcon className='size-7 stroke-1 lg:size-8' />
              </div>
            </div>
          </div>

          <div className='flex w-full items-center justify-between py-2.5'>
            <div
              ref={iconRef3}
              className='bg-background flex size-[3.75rem] shrink-0 items-center justify-center rounded-xl border-[1.5px] shadow-xl md:size-[4.5rem] lg:size-[5.75rem]'
            >
              <Workflow className='size-8 stroke-1 md:size-10 lg:size-[3.25rem]' />
            </div>
            <div className='flex items-center justify-between md:w-full md:max-w-[17.5rem] lg:max-w-[25rem]'>
              <div className='flex w-full max-w-14 justify-between sm:max-w-16 md:max-w-20'>
                <span ref={spanRef3} className='size-0.5' />
                <span ref={spanRef4} className='size-0.5' />
              </div>
              <div ref={iconRef4} className='bg-secondary flex items-center justify-center rounded-xl border p-2'>
                <div className='bg-primary flex size-16 items-center justify-center rounded-lg border-[1.5px] shadow-xl md:size-[5.75rem]'>
                  <div className='flex size-12 items-center justify-center rounded-md bg-background md:size-20'>
                    <Image src='/icon.svg' alt='TradingGoose logo' width={64} height={64} className='h-12 w-12 md:h-20 md:w-20' priority />
                  </div>
                </div>
              </div>
              <div className='flex w-full max-w-14 justify-between sm:max-w-16 md:max-w-20'>
                <span ref={spanRef5} className='size-0.5' />
                <span ref={spanRef6} className='size-0.5' />
              </div>
            </div>
            <div
              ref={iconRef5}
              className='bg-background flex size-[3.75rem] shrink-0 items-center justify-center rounded-xl border-[1.5px] shadow-xl md:size-[4.5rem] lg:size-[5.75rem]'
            >
              <BotMessageSquareIcon className='size-8 stroke-1 md:size-10 lg:size-[3.25rem]' />
            </div>
          </div>

          <div className='flex w-full max-w-4xl items-center justify-between'>
            <div className='flex items-center gap-6 sm:gap-10 md:gap-[7.5rem]'>
              <div
                ref={iconRef6}
                className='bg-background flex size-12 items-center justify-center rounded-xl border-[1.5px] shadow-md lg:size-[3.75rem]'
              >
                <CodeXmlIcon className='size-6 stroke-1 lg:size-8' />
              </div>
              <span ref={spanRef7} className='size-0.5' />
            </div>
            <div className='flex items-center gap-6 sm:gap-10 md:gap-[7.5rem]'>
              <span ref={spanRef8} className='size-0.5' />
              <div
                ref={iconRef7}
                className='bg-background flex size-12 items-center justify-center rounded-xl border-[1.5px] shadow-md lg:size-[3.75rem]'
              >
                <ChartLine className='size-7 stroke-1 lg:size-[2.75rem]' />
              </div>
            </div>
          </div>

          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef1}
            toRef={spanRef1}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef1}
            toRef={spanRef3}
            gradientStartColor='var(--primary)'
            duration={4.5}
            curvature={-45}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef2}
            toRef={spanRef2}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef2}
            toRef={spanRef6}
            gradientStartColor='var(--primary)'
            duration={4.5}
            curvature={-45}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef6}
            toRef={spanRef7}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef7}
            toRef={spanRef4}
            gradientStartColor='var(--primary)'
            duration={4.5}
            curvature={40}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef7}
            toRef={spanRef8}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef8}
            toRef={spanRef5}
            gradientStartColor='var(--primary)'
            duration={4.5}
            curvature={40}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef3}
            toRef={spanRef3}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef3}
            toRef={spanRef4}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef4}
            toRef={iconRef4}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef4}
            toRef={spanRef5}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef5}
            toRef={spanRef6}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={spanRef6}
            toRef={iconRef5}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1]'
          />

          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef3}
            toRef={iconRef4}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1] md:hidden'
          />
          <AnimatedBeam
            containerRef={containerRef}
            fromRef={iconRef4}
            toRef={iconRef5}
            gradientStartColor='var(--primary)'
            duration={4.5}
            className='-z-[1] md:hidden'
          />
        </div>
      </div>
    </section>
  )
}

export default Hero
