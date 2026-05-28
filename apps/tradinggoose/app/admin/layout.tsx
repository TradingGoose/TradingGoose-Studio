import type React from 'react'
import { notFound } from 'next/navigation'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { GlobalNavbar } from '@/global-navbar'
import IntlProvider from '@/app/intl-provider'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getSystemAdminAccess()
  if (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) {
    notFound()
  }

  return (
    <IntlProvider namespaces={['nav', 'workspace', 'admin'] as const}>
      <GlobalNavbar isSystemAdmin={access.isSystemAdmin} navigationMode='admin'>
        {children}
      </GlobalNavbar>
    </IntlProvider>
  )
}
