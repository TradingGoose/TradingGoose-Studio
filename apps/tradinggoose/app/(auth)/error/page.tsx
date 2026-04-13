import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AUTH_ERROR_MESSAGE_QUERY_PARAM, getAuthErrorContent } from '@/lib/auth/auth-error-copy'
import { getBrandConfig } from '@/lib/branding/branding'
import { AuthPageHeader } from '@/app/(auth)/components/auth-page-header'
import { inter } from '@/app/fonts/inter'

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
    message?: string | string[]
  }>
}) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const error = getSingleSearchParam(resolvedSearchParams.error)
  const explicitMessage =
    getSingleSearchParam(resolvedSearchParams[AUTH_ERROR_MESSAGE_QUERY_PARAM]) ||
    getSingleSearchParam(resolvedSearchParams.error_description)
  const { code, content } = getAuthErrorContent(error, explicitMessage)
  const brand = getBrandConfig()
  const supportEmail = brand.supportEmail || 'support@tradinggoose.ai'

  return (
    <div className='space-y-8 text-center'>
      <AuthPageHeader
        eyebrow='Authentication error'
        title={content.title}
        description={content.description}
      />

      {code ? (
        <div className='rounded-lg border border-border/80 bg-muted/30 px-4 py-3'>
          <p
            className={`${inter.className} font-medium text-[11px] text-muted-foreground uppercase tracking-[0.24em]`}
          >
            Error code
          </p>
          <code className='mt-2 block break-all font-mono text-[13px] text-foreground'>
            {error}
          </code>
        </div>
      ) : null}

      <p className={`${inter.className} text-muted-foreground text-sm`}>
        If this keeps happening, contact{' '}
        <a
          href={`mailto:${supportEmail}`}
          className='font-medium text-foreground underline underline-offset-4 transition hover:text-primary'
        >
          support
        </a>{' '}
        and include the error code.
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
