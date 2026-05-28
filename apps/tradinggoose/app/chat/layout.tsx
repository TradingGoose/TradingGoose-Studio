import type { ReactNode } from 'react'
import IntlProvider from '@/app/intl-provider'

export default function ChatLayout({ children }: { children: ReactNode }) {
  return <IntlProvider namespaces={['nav', 'chat'] as const}>{children}</IntlProvider>
}
