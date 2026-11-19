import { getPublicCopy } from '@/i18n/public-copy'
import { formatTemplate, type LocaleInput, normalizeLocaleCode } from '@/i18n/utils'

export function getEmailCopy(locale: LocaleInput) {
  return getPublicCopy(normalizeLocaleCode(locale)).emails
}

export function emailText(
  locale: LocaleInput,
  template: string,
  values: Record<string, string | number>
) {
  return formatTemplate(template, values, normalizeLocaleCode(locale))
}

export function formatEmailDate(locale: LocaleInput, date: Date) {
  return new Intl.DateTimeFormat(normalizeLocaleCode(locale), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function formatEmailDateTime(locale: LocaleInput, date: Date) {
  return new Intl.DateTimeFormat(normalizeLocaleCode(locale), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
