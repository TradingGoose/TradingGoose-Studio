import { getLocale } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { getAuthErrorContent, normalizeAuthErrorCallbackSegments } from '@/lib/auth/auth-error-copy'
import { getBrandConfig } from '@/lib/branding/branding'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { inter } from '@/app/fonts/inter'
import { Link } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import type { LocaleCode } from '@/i18n/utils'

function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AuthErrorPage({
  params,
  searchParams,
}: {
  params?: Promise<{ callback?: string[] }>
  searchParams?: Promise<{
    error?: string | string[]
    error_description?: string | string[]
  }>
}) {
  const [resolvedParams, resolvedSearchParams] = await Promise.all([params, searchParams])
  const error = getSingleSearchParam(resolvedSearchParams?.error)
  const errorDescription = getSingleSearchParam(resolvedSearchParams?.error_description)
  const callbackUrl = normalizeAuthErrorCallbackSegments(resolvedParams?.callback)
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const { code, content } = getAuthErrorContent(copy, error, errorDescription, callbackUrl)
  const brand = getBrandConfig()
  const supportEmail = brand.supportEmail
  const errorCopy = copy.auth.error

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
          <code className='mt-2 block break-all font-mono text-[13px] text-foreground'>{code}</code>
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
          <Link href={content.primaryAction.href}>{content.primaryAction.label}</Link>
        </Button>
        <Button variant='outline' asChild className='w-full text-[15px]'>
          <Link href={content.secondaryAction.href}>{content.secondaryAction.label}</Link>
        </Button>
      </div>
    </div>
  )
}
