'use client'

import { useEffect, useRef } from 'react'

import Image from 'next/image'
import {
  ArrowRightIcon,
  BotMessageSquareIcon,
  ChartCandlestick,
  CodeXmlIcon,
  ChartLine,
  Workflow,
  LayoutDashboardIcon
} from 'lucide-react'

import { AnimatedBeam } from '@/components/ui/animated-beam'
import { MotionPreset } from '@/components/ui/motion-preset'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const Hero = () => {
  const imageContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = imageContainerRef.current

    if (!container) return

    // Check if screen is large enough for 3D effects (1024px+)
    const checkScreenSize = () => window.innerWidth >= 1024

    /**
     * Handle mouse movement for 3D tilt effect
     * Calculates rotation based on mouse position relative to container center
     */
    const handleMouseMove = (e: MouseEvent) => {
      if (!checkScreenSize()) return

      const rect = container.getBoundingClientRect()

      // Calculate rotation angles (reduced multiplier for subtle effect)
      const x = (e.clientX - rect.left - rect.width / 2) * 0.0075
      const y = (e.clientY - rect.top - rect.height / 2) * 0.0075

      // Apply 3D transform with perspective and slight scale
      container.style.transform = `perspective(1000px) rotateX(${y}deg) rotateY(${x}deg) scale3d(1.01, 1.01, 1.01)`
      container.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.15)'
    }

    // Initialize hover state with smooth transition
    const handleMouseEnter = (e: MouseEvent) => {
      if (!checkScreenSize()) return

      container.style.transition = 'transform 0.2s ease, box-shadow 0.2s ease'
      handleMouseMove(e)
    }

    // Reset to neutral position when mouse leaves
    const handleMouseLeave = () => {
      container.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)'
      container.style.boxShadow = 'none'
      container.style.transition = 'transform 0.5s ease, box-shadow 0.5s ease'
    }

    // Add event listeners for 3D tilt interaction
    container.addEventListener('mouseenter', handleMouseEnter)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseleave', handleMouseLeave)

    // Cleanup event listeners on unmount
    return () => {
      container.removeEventListener('mouseenter', handleMouseEnter)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

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
          <Badge variant='outline' className='relative z-10 text-sm font-normal'>
            TradingGoose Studio is now live! 🚀
          </Badge>

          <h1 className='relative z-10 text-2xl font-semibold sm:text-3xl lg:text-5xl lg:font-bold'>
            LLM Workflows for <span className='underline underline-offset-3'>Trading Analysis</span>
          </h1>

          <p className='relative z-10 text-muted-foreground max-w-4xl text-xl'>
            Build and deploy AI agent workflows that fit your investment analysis styles
          </p>

          <div className='relative z-10 mt-6 flex flex-wrap items-center gap-4'>
            <Button
              size='sm'
              className='group relative w-fit overflow-hidden rounded-md px-6 font-bold shadow-md before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.5)_50%,transparent_75%,transparent_100%)] before:bg-[length:250%_250%,100%_100%] before:bg-[position:200%_0,0_0] before:bg-no-repeat before:transition-[background-position_0s_ease] before:duration-1000 hover:before:bg-[position:-100%_0,0_0] dark:before:bg-[linear-gradient(45deg,transparent_25%,rgba(0,0,0,0.2)_50%,transparent_75%,transparent_100%)]'
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
      <div className="mx-auto flex max-w-7xl flex-col mt-20 items-center px-4 sm:px-6 lg:px-8">
        <div className='flex flex-col items-center text-center'>
          {/* Hero Image with 3D Tilt Effect */}
          <MotionPreset
            ref={imageContainerRef}
            fade
            zoom={{ initialScale: 0.5 }}
            delay={1.3}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className='rounded-xl'
          >
            <Image
              src='https://cdn.shadcnstudio.com/ss-assets/blocks/marketing/hero/image-18.png'
              alt='hero-image'
              width={1200}
              height={675}
              className='w-full rounded-xl object-cover dark:hidden'
              sizes='200vw'
              priority
            />
            <Image
              src='https://cdn.shadcnstudio.com/ss-assets/blocks/marketing/hero/image-18-dark.png'
              alt='hero-image'
              width={1200}
              height={675}
              className='hidden w-full rounded-xl object-cover dark:inline-block'
              sizes='200vw'
              priority
            />
          </MotionPreset>
        </div>
      </div>
    </section>
  )
}

export default Hero
