import type { NextRequest } from 'next/server'
import { defaultLocale, isLocaleCode, LOCALE_COOKIE, type LocaleCode } from '@/i18n/utils'

type AcceptLanguageCandidate = {
  locale: LocaleCode
  quality: number
  index: number
}

function getAcceptLanguageLocale(header: string | null): LocaleCode | null {
  if (!header) return null

  const candidates: AcceptLanguageCandidate[] = []
  header.split(',').forEach((entry, index) => {
    const [rawLanguageRange, ...rawParams] = entry
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)

    if (!rawLanguageRange || rawLanguageRange === '*') return

    const locale = rawLanguageRange.toLowerCase().split('-', 1)[0]
    if (!isLocaleCode(locale)) return

    const qualityParam = rawParams.find((param) => param.toLowerCase().startsWith('q='))
    const quality = qualityParam ? Number.parseFloat(qualityParam.slice(2)) : 1
    if (!Number.isFinite(quality) || quality <= 0) return

    candidates.push({ locale, quality, index })
  })

  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index)
  return candidates[0]?.locale ?? null
}

export function resolveRequestLocale(request: NextRequest): LocaleCode {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
  return (
    (cookieLocale && isLocaleCode(cookieLocale) ? cookieLocale : null) ??
    getAcceptLanguageLocale(request.headers.get('accept-language')) ??
    defaultLocale
  )
}
