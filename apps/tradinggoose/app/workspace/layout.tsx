import type React from 'react'
import WorkspaceLayoutClient from './layout-client'

export default function WorkspaceRootLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceLayoutClient>{children}</WorkspaceLayoutClient>
}
