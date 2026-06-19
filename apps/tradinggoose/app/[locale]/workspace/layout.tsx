import type React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getSystemAdminAccess } from '@/lib/admin/access'
import WorkspaceLayoutClient from '@/app/workspace/layout-client'
import { GlobalNavbar } from '@/global-navbar'
import { getClientMessages } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

export default async function WorkspaceRootLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const [{ locale: routeLocale }, access] = await Promise.all([params, getSystemAdminAccess()])
  const locale = routeLocale as LocaleCode

  return (
    <NextIntlClientProvider locale={locale} messages={getClientMessages(locale, 'workspace')}>
      <WorkspaceLayoutClient
        user={
          access.userId
            ? {
                id: access.userId,
                name: access.user?.name ?? null,
                email: access.user?.email,
              }
            : null
        }
      >
        <GlobalNavbar
          isSystemAdmin={access.isSystemAdmin}
          workspaceUser={
            access.userId
              ? {
                  id: access.userId,
                  email: access.user?.email ?? null,
                }
              : null
          }
        >
          {children}
        </GlobalNavbar>
      </WorkspaceLayoutClient>
    </NextIntlClientProvider>
  )
}
