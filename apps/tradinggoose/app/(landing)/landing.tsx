import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import CallToAction from '@/app/(landing)/components/cta/cta'
import Footer from '@/app/(landing)/components/footer/footer'
import Hero from '@/app/(landing)/components/hero/hero'
import MonitorSection from '@/app/(landing)/components/monitor-preview/monitor-section'
import PublicNav from '@/app/(landing)/components/nav/public-nav'
import StructuredData from '@/app/(landing)/components/structured-data'
import {
  FeatureSkeleton,
  HowItWorksSkeleton,
  IntegrationsSkeleton,
  MonitorSectionSkeleton,
} from '@/app/(landing)/landing-skeletons'

const HowItWorks = dynamic(() => import('@/app/(landing)/components/how-it-works/how-it-works'), {
  loading: () => <HowItWorksSkeleton />,
})

const Feature = dynamic(() => import('@/app/(landing)/components/feature/feature'), {
  loading: () => <FeatureSkeleton />,
})

const Integrations = dynamic(() => import('@/app/(landing)/components/integrations/integrations'), {
  loading: () => <IntegrationsSkeleton />,
})

export default async function Landing() {
  const registrationMode = await getRegistrationModeForRender()

  return (
    <>
      <StructuredData />
      <PublicNav registrationMode={registrationMode} />
      <main className='relative border-border border-b pb-48'>
        <Hero registrationMode={registrationMode} />
        <HowItWorks />
        <Suspense fallback={<MonitorSectionSkeleton />}>
          <MonitorSection />
        </Suspense>
        <Feature />
        <Integrations />
        <CallToAction />
      </main>
      <Footer />
    </>
  )
}
