import type React from 'react'
import { notFound } from 'next/navigation'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { GlobalNavbar } from '@/global-navbar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await getSystemAdminAccess()
  if (
    !access.isAuthenticated ||
    (!access.isSystemAdmin && !access.canBootstrapSystemAdmin) ||
    !access.user
  ) {
    notFound()
  }

  return (
    <GlobalNavbar isSystemAdmin={access.isSystemAdmin} navigationMode='admin'>
      {children}
    </GlobalNavbar>
  )
}
