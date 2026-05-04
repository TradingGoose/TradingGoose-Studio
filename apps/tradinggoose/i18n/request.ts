import { getRequestConfig } from 'next-intl/server'
import { getPublicCopy } from './public-copy'
import { defaultLocale, isLocaleCode } from './utils'

export default getRequestConfig(async ({ requestLocale }) => {
  const requestedLocale = await requestLocale
  const locale = requestedLocale && isLocaleCode(requestedLocale) ? requestedLocale : defaultLocale

  return {
    locale,
    messages: getPublicCopy(locale),
  }
})
