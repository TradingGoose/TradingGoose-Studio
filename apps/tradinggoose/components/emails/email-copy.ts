import { getPublicCopy, formatTemplate } from '@/i18n/public-copy'
import { defaultLocale, isLocaleCode, type LocaleCode } from '@/i18n/utils'

export type EmailLocale = LocaleCode | string | null | undefined

export function normalizeEmailTemplateLocale(locale: EmailLocale): LocaleCode {
  return locale && isLocaleCode(locale) ? locale : defaultLocale
}

export function getEmailCopy(locale: EmailLocale) {
  return getPublicCopy(normalizeEmailTemplateLocale(locale)).emails
}

export function emailText(template: string, values: Record<string, string | number>) {
  return formatTemplate(template, values)
}

export function formatEmailDate(locale: EmailLocale, date: Date) {
  return new Intl.DateTimeFormat(normalizeEmailTemplateLocale(locale), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function formatEmailDateTime(locale: EmailLocale, date: Date) {
  return new Intl.DateTimeFormat(normalizeEmailTemplateLocale(locale), {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatEmailCurrency(locale: EmailLocale, value: number) {
  return new Intl.NumberFormat(normalizeEmailTemplateLocale(locale), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}
