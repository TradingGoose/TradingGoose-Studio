import type { ReactNode } from 'react'
import IntlProvider from '@/app/intl-provider'

export default function InviteLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['nav', 'invite', 'auth'] as const}>{children}</IntlProvider>
}
