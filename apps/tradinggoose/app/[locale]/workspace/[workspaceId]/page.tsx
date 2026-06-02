import { redirect } from '@/i18n/navigation'
import { type LocaleCode } from '@/i18n/utils'

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string }>
}) {
  const { locale: routeLocale, workspaceId } = await params
  const locale = routeLocale as LocaleCode

  redirect({ href: `/workspace/${workspaceId}/dashboard`, locale })
}
