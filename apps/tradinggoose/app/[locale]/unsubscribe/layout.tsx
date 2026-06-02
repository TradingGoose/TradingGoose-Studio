import type { ReactNode } from 'react'
import IntlProvider from '@/app/intl-provider'

export default function UnsubscribeLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['unsubscribe'] as const}>{children}</IntlProvider>
}
