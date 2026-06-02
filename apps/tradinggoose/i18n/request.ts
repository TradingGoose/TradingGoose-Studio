import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { getPublicCopy } from './public-copy'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale
  const locale = hasLocale(routing.locales, requestedLocale)
    ? requestedLocale
    : routing.defaultLocale

  return {
    locale,
    messages: getPublicCopy(locale),
  }
})
