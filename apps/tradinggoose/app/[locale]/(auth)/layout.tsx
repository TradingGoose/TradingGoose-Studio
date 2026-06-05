import type React from 'react'
import { Suspense } from 'react'
import AuthLayoutClient from '@/app/(auth)/layout-client'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AuthLayoutClient>{children}</AuthLayoutClient>
    </Suspense>
  )
}
