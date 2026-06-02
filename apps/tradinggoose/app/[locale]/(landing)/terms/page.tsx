import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import LegalLayout from '@/app/(landing)/components/legal-layout'
import { LegalMarkdown } from '@/app/(landing)/components/legal-markdown'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { buildLocalizedAlternates, type LocaleCode } from '@/i18n/utils'
import { getBrandConfig } from '@/lib/branding/branding'

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)

  return {
    title: copy.meta.terms.title,
    description: copy.meta.terms.description,
    alternates: buildLocalizedAlternates(locale, '/terms'),
  }
}

export default async function TermsOfService() {
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const brand = getBrandConfig()
  const termsCopy = copy.legal.terms
  const body = formatTemplate(termsCopy.bodyMarkdown, {
    projectName: brand.name,
    supportEmail: brand.supportEmail,
  })
  const lastUpdated = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(termsCopy.lastUpdatedDate))

  return (
    <LegalLayout title={termsCopy.title} path='/terms'>
      <div className='prose prose-gray mx-auto prose-h2:mt-12 prose-h3:mt-8 prose-h2:mb-6 prose-h3:mb-4 space-y-8 rounded-2xl border border-border bg-muted/50 p-12 text-accent-foreground'>
        <p className='mb-4'>
          {copy.legal.common.lastUpdatedLabel} {lastUpdated}
        </p>
        <LegalMarkdown body={body} />
      </div>
    </LegalLayout>
  )
}
