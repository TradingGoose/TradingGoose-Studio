'use client'

import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { getEnv, isTruthy } from '@/lib/env'
import { cn } from '@/lib/utils'
import { useRouter as useI18nRouter } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'

interface SSOLoginButtonProps {
  callbackURL?: string
  className?: string
  // Visual variant for button styling and placement contexts
  // - 'primary' matches the main auth action button style
  // - 'outline' matches social provider buttons
  variant?: 'primary' | 'outline'
}

export function SSOLoginButton({
  callbackURL,
  className,
  variant = 'outline',
}: SSOLoginButtonProps) {
  const router = useI18nRouter()
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)

  if (!isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))) {
    return null
  }

  const handleSSOClick = () => {
    const ssoUrl = `/sso${callbackURL ? `?callbackUrl=${encodeURIComponent(callbackURL)}` : ''}`
    router.push(ssoUrl)
  }

  const primaryBtnClasses =
    'bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-md border border-transparent font-medium text-[15px] transition-all duration-200'

  const outlineBtnClasses = cn('w-full rounded-md shadow-sm hover:bg-gray-50')

  return (
    <Button
      type='button'
      onClick={handleSSOClick}
      variant={variant === 'outline' ? 'outline' : undefined}
      className={cn(variant === 'outline' ? outlineBtnClasses : primaryBtnClasses, className)}
    >
      {copy.auth.common.signInWithSso}
    </Button>
  )
}
