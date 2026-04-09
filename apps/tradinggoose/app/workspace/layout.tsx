import type React from 'react'
import { getSystemAdminAccess } from '@/lib/admin/access'
import { GlobalNavbar } from '@/global-navbar'
import WorkspaceLayoutClient from './layout-client'

export default async function WorkspaceRootLayout({ children }: { children: React.ReactNode }) {
  const access = await getSystemAdminAccess()

  return (
    <WorkspaceLayoutClient>
      <GlobalNavbar isSystemAdmin={access.isSystemAdmin}>{children}</GlobalNavbar>
    </WorkspaceLayoutClient>
  )
}
