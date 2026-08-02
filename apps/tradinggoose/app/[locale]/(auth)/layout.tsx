import type React from 'react'
import { Suspense } from 'react'
import AuthLayoutClient from '@/app/(auth)/layout-client'
import Loading from '@/app/loading'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <AuthLayoutClient>{children}</AuthLayoutClient>
    </Suspense>
  )
}
