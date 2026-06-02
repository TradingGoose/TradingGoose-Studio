import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { type LocaleCode } from '@/i18n/utils'

interface IntlProviderProps {
  children: ReactNode
}

export default async function IntlProvider({ children }: IntlProviderProps) {
  const locale = (await getLocale()) as LocaleCode

  return (
    <NextIntlClientProvider key={locale} locale={locale}>
      {children}
    </NextIntlClientProvider>
  )
}
