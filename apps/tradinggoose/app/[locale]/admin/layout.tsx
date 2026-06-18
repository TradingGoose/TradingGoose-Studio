import type React from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { GlobalNavbar } from '@/global-navbar'
import { redirect } from '@/i18n/navigation'
import { getClientMessages } from '@/i18n/public-copy'
import { type LocaleCode, requireCanonicalCallbackPath } from '@/i18n/utils'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const [{ locale: routeLocale }, requestHeaders] = await Promise.all([params, headers()])
  const locale = routeLocale as LocaleCode
  const access = await getSystemAdminAccess(requestHeaders)

  if (!access.isAuthenticated) {
    return redirect({
      href: {
        pathname: '/login',
        query: {
          callbackUrl: requireCanonicalCallbackPath(requestHeaders, 'admin'),
        },
      },
      locale,
    })
  }

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
