import type { Messages } from 'next-intl'
import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCopy from './messages/zh.json'
import { defaultLocale, isLocaleCode, type AppLocale } from './routing'

export type PublicCopy = Messages

const PUBLIC_COPY = {
  en: enCopy,
  es: esCopy,
  zh: zhCopy,
} satisfies Record<AppLocale, PublicCopy>

export function getPublicCopy(locale: AppLocale | string | undefined): PublicCopy {
  const resolvedLocale = locale && isLocaleCode(locale) ? locale : defaultLocale
  return PUBLIC_COPY[resolvedLocale]
}
