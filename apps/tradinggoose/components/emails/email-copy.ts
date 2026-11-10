import { getPublicCopy } from '@/i18n/public-copy'
import { formatTemplate, type LocaleInput, normalizeLocaleCode } from '@/i18n/utils'

export type EmailLocale = LocaleInput

export function normalizeEmailTemplateLocale(locale: EmailLocale) {
  return normalizeLocaleCode(locale)
}

export function getEmailCopy(locale: EmailLocale) {
  return getPublicCopy(normalizeEmailTemplateLocale(locale)).emails
}

export function emailText(
  locale: EmailLocale,
  template: string,
  values: Record<string, string | number>
) {
  return formatTemplate(template, values, normalizeEmailTemplateLocale(locale))
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

export function formatEmailCurrency(locale: EmailLocale, value: DecimalAmount | null | undefined) {
  return formatUsd(normalizeEmailTemplateLocale(locale), value == null ? value : monetary(value))
}

import { type DecimalAmount, monetary } from '@tradinggoose/billing/money'
import { formatUsd } from '@/i18n/formatters'
