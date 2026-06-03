import type React from 'react'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { GlobalNavbar } from '@/global-navbar'
import { getClientMessages } from '@/i18n/public-copy'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [access, locale] = await Promise.all([getSystemAdminAccess(), getLocale()])
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
