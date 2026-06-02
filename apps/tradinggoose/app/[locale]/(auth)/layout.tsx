import type React from 'react'
import IntlProvider from '@/app/intl-provider'
import AuthLayoutClient from '@/app/(auth)/layout-client'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <IntlProvider namespaces={['nav', 'registration', 'auth'] as const}>
      <AuthLayoutClient>{children}</AuthLayoutClient>
    </IntlProvider>
  )
}
