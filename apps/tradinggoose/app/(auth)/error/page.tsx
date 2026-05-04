import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { getAuthErrorActionLabel, getAuthErrorContent } from '@/lib/auth/auth-error-copy'
import { getBrandConfig } from '@/lib/branding/branding'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { inter } from '@/app/fonts/inter'
import { getPublicCopy } from '@/i18n/public-copy'
import { defaultLocale, isLocaleCode, localizeHref, type LocaleCode } from '@/i18n/utils'

export const dynamic = 'force-dynamic'

function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams?: Promise<{
    error?: string | string[]
    error_description?: string | string[]
  }>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const error = getSingleSearchParam(resolvedSearchParams.error)
  const errorDescription = getSingleSearchParam(resolvedSearchParams.error_description)
  const resolvedLocale = await getLocale()
  const locale: LocaleCode = isLocaleCode(resolvedLocale) ? resolvedLocale : defaultLocale
  const copy = getPublicCopy(locale)
  const errorCopy = copy.auth.error
  const { code, content } = getAuthErrorContent(copy, error, errorDescription)
  const brand = getBrandConfig()
  const supportEmail = brand.supportEmail
  const primaryAction = {
    ...content.primaryAction,
    href: localizeHref(locale, content.primaryAction.href),
    label: getAuthErrorActionLabel(copy, content.primaryAction.href, content.primaryAction.label),
  }
  const secondaryAction = {
    ...content.secondaryAction,
    href: localizeHref(locale, content.secondaryAction.href),
    label: getAuthErrorActionLabel(copy, content.secondaryAction.href, content.secondaryAction.label),
  }

  return (
    <div className='space-y-8 text-center'>
      <AuthPageHeader
        eyebrow={errorCopy.eyebrow}
        title={content.title}
        description={content.description}
      />

      {code ? (
        <div className='rounded-lg border border-border/80 bg-muted/30 px-4 py-3'>
          <p
            className={`${inter.className} font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]`}
          >
            {errorCopy.codeLabel}
          </p>
          <code className='mt-2 block break-all font-mono text-[13px] text-foreground'>
            {error}
          </code>
        </div>
      ) : null}

      <p className={`${inter.className} text-muted-foreground text-sm`}>
        {errorCopy.supportPrefix}{' '}
        <a
          href={`mailto:${supportEmail}`}
          className='font-medium text-foreground underline underline-offset-4 transition hover:text-primary'
        >
          {errorCopy.supportLinkLabel}
        </a>{' '}
        {errorCopy.supportSuffix}
      </p>

      <div className='space-y-3'>
        <Button asChild className='w-full text-[15px]'>
          <Link href={primaryAction.href}>{primaryAction.label}</Link>
        </Button>
        <Button variant='outline' asChild className='w-full text-[15px]'>
          <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
        </Button>
      </div>
    </div>
  )
}
