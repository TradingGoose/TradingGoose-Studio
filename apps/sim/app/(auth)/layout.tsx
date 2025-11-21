import type React from 'react'
import AuthLayoutClient from './layout-client'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayoutClient>{children}</AuthLayoutClient>
}
