import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { Footer, Nav, StructuredData } from '@/app/(landing)/components'

// Lazy load heavy components for better initial load performance
const Hero = dynamic(() => import('@/app/(landing)/components/hero/hero'), {
  loading: () => <div className='h-[600px] animate-pulse bg-gray-50' />,
})

const HowItWorks = dynamic(() => import('@/app/(landing)/components/how-it-works/how-it-works'), {
  loading: () => <div className='h-[200px] animate-pulse bg-gray-50' />,
})

const MonitorSection = dynamic(
  () => import('@/app/(landing)/components/monitor-preview/monitor-section'),
  {
    loading: () => <div className='h-[400px] animate-pulse bg-gray-50' />,
  }
)

const Feature = dynamic(() => import('@/app/(landing)/components/feature/feature'), {
  loading: () => <div className='h-[600px] animate-pulse bg-gray-50' />,
})



const Integrations = dynamic(() => import('@/app/(landing)/components/integrations/integrations'), {
  loading: () => <div className='h-[300px] animate-pulse bg-gray-50' />,
})

const CallToAction = dynamic(() => import('@/app/(landing)/components/cta/cta'), {
  loading: () => <div className='h-[200px] animate-pulse bg-gray-50' />,
})

export default function Landing() {
  return (
    <>
      <StructuredData />
      <Nav />
      <main className='relative border-border border-b pb-48'>
        <Suspense
          fallback={
            <div className='h-[600px] animate-pulse bg-gray-50' aria-label='Loading hero section' />
          }
        >
          <Hero />
        </Suspense>
        <Suspense
          fallback={
            <div
              className='h-[200px] animate-pulse bg-gray-50'
              aria-label='Loading how it works section'
            />
          }
        >
          <HowItWorks />
        </Suspense>
        <Suspense
          fallback={
            <div
              className='h-[400px] animate-pulse bg-gray-50'
              aria-label='Loading monitor section'
            />
          }
        >
          <MonitorSection />
        </Suspense>
        <Suspense
          fallback={
            <div
              className='h-[600px] animate-pulse bg-gray-50'
              aria-label='Loading feature section'
            />
          }
        >
          <Feature />
        </Suspense>
        <Suspense
          fallback={
            <div
              className='h-[300px] animate-pulse bg-gray-50'
              aria-label='Loading integrations section'
            />
          }
        >
          <Integrations />
        </Suspense>
        {/* Pricing section hidden for now */}
        <Suspense
          fallback={
            <div
              className='h-[200px] animate-pulse bg-gray-50'
              aria-label='Loading call to action section'
            />
          }
        >
          <CallToAction />
        </Suspense>
      </main>
      <Footer />
    </>
  )
}
