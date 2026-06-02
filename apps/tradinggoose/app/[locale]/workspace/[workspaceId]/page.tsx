import { redirect } from 'next/navigation'
import { isLocaleCode, localizeHref, type LocaleCode } from '@/i18n/utils'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string }>
}) {
  const { locale: routeLocale, workspaceId } = await params
  const locale: LocaleCode = isLocaleCode(routeLocale) ? routeLocale : 'en'

  redirect(localizeHref(locale, `/workspace/${workspaceId}/dashboard`))
}
