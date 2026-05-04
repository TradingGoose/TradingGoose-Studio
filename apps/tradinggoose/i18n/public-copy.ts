import type { RegistrationMode } from '@/lib/registration/shared'
import enCopy from './messages/en.json'
import esCopy from './messages/es.json'
import zhCnCopy from './messages/zh-CN.json'
import { defaultLocale, type LocaleCode } from './utils'

export type PublicCopy = typeof enCopy

const PUBLIC_COPY = {
  en: enCopy,
  es: esCopy,
  'zh-CN': zhCnCopy,
} satisfies Record<LocaleCode, PublicCopy>

export function getPublicCopy(locale: LocaleCode | string | undefined): PublicCopy {
  return PUBLIC_COPY[(locale && locale in PUBLIC_COPY ? locale : defaultLocale) as LocaleCode]
}

export function getPrimaryRegistrationLabel(copy: PublicCopy, mode: RegistrationMode) {
  return copy.registration[mode].primary
}

export function getAuthRegistrationLabel(copy: PublicCopy, mode: RegistrationMode) {
  return copy.registration[mode].auth
}

export function formatTemplate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template
  )
}
