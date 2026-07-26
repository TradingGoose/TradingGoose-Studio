import { defineRouting } from 'next-intl/routing'
import type messages from './messages/en.json'

export const locales = ['en', 'es', 'zh'] as const
export const defaultLocale = 'en' satisfies (typeof locales)[number]

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  // Proxy owns locale negotiation so every renderable page URL stays explicitly prefixed.
  localeDetection: false,
  alternateLinks: false,
})

export type AppLocale = (typeof locales)[number]

export function isLocaleCode(value: string): value is AppLocale {
  return (locales as readonly string[]).includes(value)
}

declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale
    Messages: typeof messages
  }
}
