import { getRegistrationModeForRender } from '@/lib/registration/service'
import CallToAction from '@/app/(landing)/components/cta/cta'
import Footer from '@/app/(landing)/components/footer/footer'
import Feature from '@/app/(landing)/components/feature/feature'
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
        <Feature />
        <Integrations />
        <CallToAction />
      </main>
      <Footer />
    </>
  )
}
