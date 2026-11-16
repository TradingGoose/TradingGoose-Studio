import { createElement } from 'react'
import { ProviderIcon } from '@/components/icons/provider-icon'

export function getProviderIcon(provider: string) {
  return function Icon({ className }: { className?: string }) {
    return createElement(ProviderIcon, { provider, className })
  }
}
