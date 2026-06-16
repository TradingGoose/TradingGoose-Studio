'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDownIcon, LanguagesIcon, MenuIcon } from 'lucide-react'
import Image from 'next/image'
import { useSearchParams } from 'next/navigation'
import { useLocale, useMessages } from 'next-intl'
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
import { useSession } from '@/lib/auth-client'
import { useBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import { getRegistrationPrimaryHref, type RegistrationMode } from '@/lib/registration/shared'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import { soehne } from '@/app/fonts/soehne/soehne'
import { UserMenu } from '@/global-navbar/components/user-menu'
import { SettingsDialog } from '@/global-navbar/settings-modal/settings-dialog'
import type { SettingsSection } from '@/global-navbar/settings-modal/types'
import { Link, replaceLocaleDocument, usePathname, useRouter } from '@/i18n/navigation'
import {
  formatTemplate,
  getLocaleDisplayName,
  type LocaleCode,
  locales,
  localizeDocsUrl,
} from '@/i18n/utils'
import { useGeneralStore } from '@/stores/settings/general/store'

const logger = createLogger('nav')

interface NavProps {
  hideAuthButtons?: boolean
  variant?: 'landing' | 'auth'
  registrationMode?: RegistrationMode | null
  authenticatedUser?: {
    id: string
    email: string
    name?: string | null
    image?: string | null
    updatedAt?: Date | string | null
  } | null
  canAccessSystemAdmin?: boolean
}

function LanguageSwitcher() {
  const locale = useLocale() as LocaleCode
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const updateSetting = useGeneralStore((state) => state.updateSetting)
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)

  const search = searchParams.toString()

  const changeLocale = async (nextLocale: LocaleCode) => {
    if (nextLocale === locale) {
      setIsOpen(false)
      return
    }

    setIsOpen(false)
    const href = search ? `${pathname}?${search}` : pathname
    if (session?.user?.id) {
      try {
        await updateSetting('preferredLocale', nextLocale)
      } catch (error) {
        logger.error('Failed to persist preferred locale:', { error, locale: nextLocale })
      }
    }
    replaceLocaleDocument(nextLocale, href)
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className='rounded-md px-3 font-medium text-sm'>
          <LanguagesIcon className='h-4 w-4' />
          <span>{getLocaleDisplayName(locale)}</span>
          <ChevronDownIcon className='h-4 w-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-48'>
        {locales.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={() => {
              void changeLocale(code)
            }}
            className='flex items-center gap-2'
          >
            <span>{getLocaleDisplayName(code)}</span>
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
  authenticatedUser = null,
  canAccessSystemAdmin = false,
}: NavProps = {}) {
  const [githubStars, setGithubStars] = useState('0')
  const router = useRouter()
  const brand = useBrandConfig()
  const locale = useLocale() as LocaleCode
  const copy = useMessages()
  const { data: session, isPending: isSessionPending } = useSession()
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>('account')
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const hasResolvedRegistrationMode = registrationMode !== null
  const registrationPrimaryHref = registrationMode
    ? getRegistrationPrimaryHref(registrationMode)
    : null
  const registrationPrimaryLabel = registrationMode
    ? copy.registration[registrationMode].primary
    : null
  const showStandaloneLogin = hasResolvedRegistrationMode && registrationPrimaryHref !== null
  const user = isSessionPending ? authenticatedUser : session?.user
  const isAuthenticated = Boolean(user?.id)
  const userId = user?.id ?? null
  const userName = user?.name ?? brand.name
  const userEmail = user?.email ?? brand.supportEmail ?? 'support@tradinggoose.ai'
  const userAvatar = user?.image
  const userAvatarVersion = user?.updatedAt ? new Date(user.updatedAt).getTime() : null
  const showStandaloneLanguageSwitcher = variant !== 'landing' || !isAuthenticated

  const openSettings = useCallback((section: SettingsSection) => {
    setActiveSettingsSection(section)
    setIsSettingsModalOpen(true)
  }, [])

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

  const navigateToLogin = useCallback(() => {
    router.push('/login?reauth=1')
  }, [router])

  const navigateToPrimaryCta = useCallback(() => {
    if (!registrationPrimaryHref) {
      return
    }

    router.push(registrationPrimaryHref)
  }, [registrationPrimaryHref, router])

  const authenticatedProfileAction =
    !hideAuthButtons && isAuthenticated ? (
      <UserMenu
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        userAvatar={userAvatar}
        userAvatarVersion={userAvatarVersion}
        onOpenSettings={openSettings}
        canAccessSystemAdmin={canAccessSystemAdmin}
      />
    ) : null

  const authenticatedDashboardAction =
    !hideAuthButtons && isAuthenticated ? (
      <Button asChild size='sm' className='rounded-md text-base'>
        <Link href='/workspace' prefetch={false}>
          {copy.nav.goToDashboard}
        </Link>
      </Button>
    ) : null

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
        aria-label={formatTemplate(copy.nav.githubRepositoryAriaLabel, { stars: githubStars })}
      >
        <GithubIcon className='h-4 w-4' aria-hidden='true' />
        <span aria-live='polite'>{githubStars}</span>
      </a>
    </div>
  )

  const registrationActions =
    !hideAuthButtons &&
    !isAuthenticated &&
    hasResolvedRegistrationMode &&
    registrationPrimaryLabel ? (
      <>
        {showStandaloneLogin ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={navigateToLogin}
            className='rounded-md text-base'
          >
            {copy.nav.login}
          </Button>
        ) : null}
        <Button
          size='sm'
          onClick={registrationPrimaryHref ? navigateToPrimaryCta : undefined}
          disabled={!registrationPrimaryHref}
          className='rounded-md text-base'
        >
          {registrationPrimaryLabel}
        </Button>
      </>
    ) : null

  return (
    <>
      <nav
        aria-label={copy.nav.primaryNavigation}
        className={`${soehne.className} sticky inset-x-0 top-0 z-50 w-full border-border border-b backdrop-blur supports-[backdrop-filter]:bg-background/20`}
        itemScope
        itemType='https://schema.org/SiteNavigationElement'
      >
        <div className='mx-auto flex w-full items-center justify-between gap-4 px-4 py-2 sm:px-6 md:px-10'>
          <Link
            href='/?from=nav'
            aria-label={formatTemplate(copy.nav.homeAriaLabel, { brand: brand.name })}
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
            {showStandaloneLanguageSwitcher ? <LanguageSwitcher /> : null}
            {variant === 'landing' &&
            !hideAuthButtons &&
            (isAuthenticated || hasResolvedRegistrationMode) ? (
              <Separator orientation='vertical' className='hidden h-6 md:block' />
            ) : null}

            {authenticatedProfileAction}

            {authenticatedDashboardAction ? (
              <div className='hidden md:block'>{authenticatedDashboardAction}</div>
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
                <DropdownMenuContent className='w-64'>
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <a
                        href={localizeDocsUrl(locale)}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='w-full'
                      >
                        {copy.nav.docs}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link href='/blog' className='w-full' prefetch={false}>
                        {copy.nav.blog}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
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
                    {isAuthenticated && !hideAuthButtons ? (
                      <DropdownMenuItem asChild>
                        <Link href='/workspace' className='w-full' prefetch={false}>
                          {copy.nav.goToDashboard}
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
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
      {isAuthenticated ? (
        <SettingsDialog
          open={isSettingsModalOpen}
          section={activeSettingsSection}
          onOpenChange={setIsSettingsModalOpen}
        />
      ) : null}
    </>
  )
}
