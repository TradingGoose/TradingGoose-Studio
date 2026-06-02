import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import LegalLayout from '@/app/(landing)/components/legal-layout'
import { LegalMarkdown } from '@/app/(landing)/components/legal-markdown'
import { getPublicCopy } from '@/i18n/public-copy'
import { buildLocalizedAlternates, type LocaleCode } from '@/i18n/utils'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)

  return {
    title: copy.meta.licenses.title,
    description: copy.meta.licenses.description,
    alternates: buildLocalizedAlternates(locale, '/licenses'),
  }
}

export default async function LicensesPage() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const licensesCopy = copy.legal.licenses

  return (
    <LegalLayout title={licensesCopy.title} path='/licenses'>
      <div className='prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 rounded-2xl border border-border bg-muted/50 p-12 text-accent-foreground'>
        <LegalMarkdown body={licensesCopy.bodyMarkdown} />
      </div>
    </LegalLayout>
  )
}
