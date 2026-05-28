import { defineRouting } from 'next-intl/routing'
import { defaultLocale, locales } from './utils'

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: {
    mode: 'as-needed',
    prefixes: {
      'zh-CN': '/zh',
    },
  },
  localeDetection: false,
})

export type AppLocale = (typeof locales)[number]
