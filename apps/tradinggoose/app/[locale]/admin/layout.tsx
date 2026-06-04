import type React from 'react'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { GlobalNavbar } from '@/global-navbar'
import { getClientMessages } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const [{ locale: routeLocale }, access] = await Promise.all([params, getSystemAdminAccess()])
  const locale = routeLocale as LocaleCode

  if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
    notFound()
  }

  return (
    <NextIntlClientProvider locale={locale} messages={getClientMessages(locale, 'admin')}>
      <GlobalNavbar isSystemAdmin={access.isSystemAdmin} navigationMode='admin'>
        {children}
      </GlobalNavbar>
    </NextIntlClientProvider>
  )
}
