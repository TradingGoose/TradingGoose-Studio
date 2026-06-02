import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import LegalLayout from '@/app/(landing)/components/legal-layout'
import { getPublicCopy } from '@/i18n/public-copy'
import { buildLocalizedAlternates, type LocaleCode } from '@/i18n/utils'
import { CareersForm } from '@/app/(landing)/careers/careers-form'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)

  return {
    title: copy.meta.careers.title,
    description: copy.meta.careers.description,
    alternates: buildLocalizedAlternates(locale, '/careers'),
  }
}

export default async function CareersPage() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)

  return (
    <LegalLayout title={copy.careers.pageTitle} path='/careers'>
      <CareersForm />
    </LegalLayout>
  )
}
