'use client'

import { useEffect, useState } from 'react'
import { ChevronDownIcon, Check, LanguagesIcon, MenuIcon } from 'lucide-react'
import Image from 'next/image'
import { useLocale } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { Link } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'
import { GithubIcon } from '@/components/icons/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getRegistrationPrimaryHref,
  type RegistrationMode,
} from '@/lib/registration/shared'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import { soehne } from '@/app/fonts/soehne/soehne'
import { getPrimaryRegistrationLabel, getPublicCopy } from '@/i18n/public-copy'
import { localizeDocsUrl, locales, type LocaleCode } from '@/i18n/utils'
import {
  buildLocaleSwitchHref,
  navigateToLocaleHref,
} from './locale-switcher'

const logger = createLogger('nav')

interface NavProps {
  hideAuthButtons?: boolean
  variant?: 'landing' | 'auth'
  registrationMode?: RegistrationMode | null
}

function LanguageSwitcher() {
  const locale = useLocale() as LocaleCode
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const copy = getPublicCopy(locale)
  const [isOpen, setIsOpen] = useState(false)

  const changeLocale = (nextLocale: LocaleCode) => {
    if (nextLocale === locale) {
      setIsOpen(false)
      return
    }

    setIsOpen(false)
    navigateToLocaleHref(buildLocaleSwitchHref(nextLocale, pathname, searchParams))
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='rounded-md px-3 font-medium text-sm'
        >
          <LanguagesIcon className='h-4 w-4' />
          <span>{copy.localeNames[locale]}</span>
          <ChevronDownIcon className='h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-48'>
        {locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={() => {
              changeLocale(code)
            }}
            className='flex items-center gap-2'
          >
            <span>{copy.localeNames[code]}</span>
            {locale === code ? <Check className='ml-auto h-4 w-4 text-primary' /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function Nav({
  hideAuthButtons = false,
  variant = 'landing',
  registrationMode = null,
}: NavProps = {}) {
  const [githubStars, setGithubStars] = useState('0')
  const brand = useBrandConfig()
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale)
  const hasResolvedRegistrationMode = registrationMode !== null
  const registrationPrimaryHref = registrationMode
    ? getRegistrationPrimaryHref(registrationMode)
    : null
  const registrationPrimaryLabel = registrationMode
    ? getPrimaryRegistrationLabel(copy, registrationMode)
    : null
  const showStandaloneLogin = hasResolvedRegistrationMode && registrationPrimaryHref !== null

  useEffect(() => {
    if (variant !== 'landing') {
      return
    }

    const timeoutId = setTimeout(() => {
      const fetchStars = async () => {
        try {
          const stars = await getFormattedGitHubStars()
          setGithubStars(stars)
        } catch (error) {
          logger.warn('Error fetching GitHub stars:', error)
        }
      }

      fetchStars()
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [variant])

  const desktopNavLinks = variant === 'landing' && (
    <div className='hidden items-center gap-6 font-medium text-muted-foreground text-sm md:flex'>
      <a
        href={localizeDocsUrl(locale)}
        target='_blank'
        rel='noopener noreferrer'
        className='transition-colors hover:text-foreground'
      >
        {copy.nav.docs}
      </a>
      <Link href='/blog' className='transition-colors hover:text-foreground' prefetch={false}>
        {copy.nav.blog}
      </Link>
      <a
        href='https://github.com/TradingGoose/TradingGoose-Studio'
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-2 transition-colors hover:text-foreground'
        aria-label={`GitHub repository - ${githubStars} stars`}
      >
        <GithubIcon className='h-4 w-4' aria-hidden='true' />
        <span aria-live='polite'>{githubStars}</span>
      </a>
    </div>
  )

  const registrationActions =
    !hideAuthButtons && hasResolvedRegistrationMode && registrationPrimaryLabel ? (
      <>
        {showStandaloneLogin ? (
          <Button variant='ghost' size='sm' asChild className='rounded-md text-base'>
            <Link href='/login?reauth=1'>{copy.nav.login}</Link>
          </Button>
        ) : null}
        {registrationPrimaryHref ? (
          <Button size='sm' asChild className='rounded-md text-base'>
            <Link href={registrationPrimaryHref}>{registrationPrimaryLabel}</Link>
          </Button>
        ) : (
          <Button size='sm' disabled className='rounded-md text-base'>
            {registrationPrimaryLabel}
          </Button>
        )}
      </>
    ) : null

  return (
    <nav
      aria-label='Primary navigation'
      className={`${soehne.className} sticky inset-x-0 top-0 z-50 w-full border-border border-b backdrop-blur supports-[backdrop-filter]:bg-background/20`}
      itemScope
      itemType='https://schema.org/SiteNavigationElement'
    >
      <div className='mx-auto flex w-full items-center justify-between gap-4 px-4 py-2 sm:px-6 md:px-10'>
        <Link
          href='/?from=nav'
          aria-label={`${brand.name} home`}
          itemProp='url'
          className='flex h-9 items-center gap-2'
          prefetch={false}
        >
          <span itemProp='name' className='sr-only'>
            {brand.name} {copy.nav.homeLabel}
          </span>
          <span
            className='flex items-center gap-2 font-semibold text-[18px] text-foreground tracking-tight'
            aria-hidden='true'
          >
            <Image
              src='/icon.svg'
              alt=''
              width={28}
              height={28}
              className='h-7 w-7'
              priority
              loading='eager'
              quality={100}
            />
            {brand.name}
          </span>
        </Link>

        <div className='flex items-center gap-3 sm:gap-4'>
          {desktopNavLinks}
          <LanguageSwitcher />
          {variant === 'landing' && !hideAuthButtons && hasResolvedRegistrationMode ? (
            <Separator orientation='vertical' className='hidden h-6 md:block' />
          ) : null}

          {registrationActions ? (
            <div className='hidden items-center gap-2 md:flex'>{registrationActions}</div>
          ) : null}

          {variant === 'landing' ? (
            <DropdownMenu>
              <DropdownMenuTrigger className='md:hidden' asChild>
                <Button variant='outline' size='icon'>
                  <MenuIcon className='h-5 w-5' />
                  <span className='sr-only'>{copy.nav.menu}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className='w-64' align='end'>
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <a
                      href={localizeDocsUrl(locale)}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='w-full'
                    >
                      {copy.nav.docs}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href='/blog' className='w-full' prefetch={false}>
                      {copy.nav.blog}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a
                      href='https://github.com/TradingGoose/TradingGoose-Studio'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='flex w-full items-center gap-2'
                    >
                      <GithubIcon className='h-4 w-4' aria-hidden='true' />
                      <span aria-live='polite'>{githubStars}</span>
                    </a>
                  </DropdownMenuItem>
                  {registrationActions ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className='!bg-transparent'>
                        <div className='flex w-full flex-col gap-2'>{registrationActions}</div>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </nav>
  )
}
