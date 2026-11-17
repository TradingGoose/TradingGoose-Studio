import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import NotFoundContent from '@/app/not-found-content'
import { getClientMessages } from '@/i18n/public-copy'
import { defaultLocale, isLocaleCode, type LocaleCode } from '@/i18n/utils'

export default async function NotFound() {
  const requestLocale = await getLocale()
  const locale: LocaleCode = isLocaleCode(requestLocale) ? requestLocale : defaultLocale

  return (
    <NextIntlClientProvider locale={locale} messages={getClientMessages(locale)}>
      <NotFoundContent />
    </NextIntlClientProvider>
  )
}
