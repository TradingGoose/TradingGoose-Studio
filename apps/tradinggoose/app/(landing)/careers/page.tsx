import type { Metadata } from 'next'
import LegalLayout from '@/app/(landing)/components/legal-layout'
import { CareersForm } from './careers-form'

export const metadata: Metadata = {
  title: 'Careers | TradingGoose',
  description: 'Join the TradingGoose Studio team.',
  alternates: {
    canonical: '/careers',
  },
}

export default function CareersPage() {
  return (
    <LegalLayout title='Join Our Team' path='/careers'>
      <CareersForm />
    </LegalLayout>
  )
}
