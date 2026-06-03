import type React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { getSystemAdminAccess } from '@/lib/admin/access'
import WorkspaceLayoutClient from '@/app/workspace/layout-client'
import { GlobalNavbar } from '@/global-navbar'
import { getClientMessages } from '@/i18n/public-copy'

export default async function WorkspaceRootLayout({ children }: { children: React.ReactNode }) {
  const [access, locale] = await Promise.all([getSystemAdminAccess(), getLocale()])

  return (
    <NextIntlClientProvider locale={locale} messages={getClientMessages(locale, 'workspace')}>
      <WorkspaceLayoutClient>
        <GlobalNavbar isSystemAdmin={access.isSystemAdmin}>{children}</GlobalNavbar>
      </WorkspaceLayoutClient>
    </NextIntlClientProvider>
  )
}
