import { defineRouting } from 'next-intl/routing'
import { defaultLocale, locales } from './utils'

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'as-needed',
  localeDetection: false,
})

export type AppLocale = (typeof locales)[number]
