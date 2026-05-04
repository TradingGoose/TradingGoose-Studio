import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { defaultLocale, isLocaleCode, localizeHref, type LocaleCode } from '@/i18n/utils'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const requestHeaders = await headers()
  const resolvedLocale = requestHeaders.get('x-next-intl-locale') ?? ''
  const locale: LocaleCode = isLocaleCode(resolvedLocale) ? resolvedLocale : defaultLocale
  redirect(localizeHref(locale, `/workspace/${workspaceId}/dashboard`))
}
