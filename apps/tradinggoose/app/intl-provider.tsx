import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { getScopedPublicMessages } from '@/i18n/public-copy'
import type { PublicMessages } from '@/i18n/message-types'
import { type LocaleCode } from '@/i18n/utils'

interface IntlProviderProps {
  children: ReactNode
  namespaces?: readonly (keyof PublicMessages)[]
}

export default async function IntlProvider({ children, namespaces }: IntlProviderProps) {
  const locale = (await getLocale()) as LocaleCode
  // Route layouts intentionally scope messages. Include every namespace used by shared children.
  const messages = namespaces?.length ? getScopedPublicMessages(locale, namespaces) : undefined

  return (
    <NextIntlClientProvider
      key={locale}
      locale={locale}
      {...(messages ? { messages } : {})}
    >
      {children}
    </NextIntlClientProvider>
  )
}
