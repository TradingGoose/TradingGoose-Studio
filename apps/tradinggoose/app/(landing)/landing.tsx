import { TooltipProvider } from '@/components/ui/tooltip'
import { getRegistrationModeForRender } from '@/lib/registration/service'
import CallToAction from '@/app/(landing)/components/cta/cta'
import Feature from '@/app/(landing)/components/feature/feature'
import Footer from '@/app/(landing)/components/footer/footer'
import Hero from '@/app/(landing)/components/hero/hero'
import HowItWorks from '@/app/(landing)/components/how-it-works/how-it-works'
import Integrations from '@/app/(landing)/components/integrations/integrations'
import MonitorSection from '@/app/(landing)/components/monitor-preview/monitor-section'
import PublicNav from '@/app/(landing)/components/nav/public-nav'
import StructuredData from '@/app/(landing)/components/structured-data'

export default async function Landing() {
  const registrationMode = await getRegistrationModeForRender()

  return (
    <>
      <StructuredData />
      <PublicNav registrationMode={registrationMode} />
      <main className='relative border-border border-b pb-48'>
        <Hero registrationMode={registrationMode} />
        <HowItWorks />
        <MonitorSection />
        <TooltipProvider delayDuration={100} skipDelayDuration={0}>
          <Feature />
        </TooltipProvider>
        <Integrations />
        <CallToAction />
      </main>
      <Footer />
    </>
  )
}
