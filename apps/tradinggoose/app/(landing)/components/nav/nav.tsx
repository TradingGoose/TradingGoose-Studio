'use client'

import type { MouseEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { MenuIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  getRegistrationPrimaryLabel,
  type RegistrationMode,
} from '@/lib/registration/shared'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import { soehne } from '@/app/fonts/soehne/soehne'
import { useRegistrationState } from '@/hooks/queries/registration'

const logger = createLogger('nav')

interface NavProps {
  hideAuthButtons?: boolean
  variant?: 'landing' | 'auth' | 'legal'
  registrationMode?: RegistrationMode | null
}

export default function Nav({
  hideAuthButtons = false,
  variant = 'landing',
  registrationMode: registrationModeOverride,
}: NavProps = {}) {
  const [githubStars, setGithubStars] = useState('0')
  const router = useRouter()
  const brand = useBrandConfig()
  const shouldQueryRegistrationState =
    variant === 'landing' && !hideAuthButtons && registrationModeOverride === undefined
  const registrationQuery = useRegistrationState(shouldQueryRegistrationState)
  const queriedRegistrationMode = registrationQuery.data?.registrationMode ?? null
  const registrationMode = registrationModeOverride ?? queriedRegistrationMode
  const hasResolvedRegistrationMode =
    registrationModeOverride !== undefined
      ? registrationModeOverride !== null
      : registrationQuery.status === 'success' && !!queriedRegistrationMode
  const registrationPrimaryHref = registrationMode
    ? getRegistrationPrimaryHref(registrationMode)
    : null
  const registrationPrimaryLabel = registrationMode
    ? getRegistrationPrimaryLabel(registrationMode)
    : null
  const showStandaloneLogin = hasResolvedRegistrationMode && registrationMode !== 'disabled'

  useEffect(() => {
    if (variant !== 'landing') return

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

  const handleLoginClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      navigateToLogin()
    },
    [navigateToLogin]
  )

  const handleEnterpriseClick = useCallback(() => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank', 'noopener,noreferrer')
  }, [])

  const desktopNavLinks = variant === 'landing' && (
    <div className='hidden items-center gap-6 font-medium text-muted-foreground text-sm md:flex'>
      <Link
        href='https://docs.tradinggoose.ai'
        target='_blank'
        rel='noopener noreferrer'
        className='transition-colors hover:text-foreground'
        prefetch={false}
      >
        Docs
      </Link>
      <Link href='/blog' className='transition-colors hover:text-foreground' prefetch={false}>
        Blog
      </Link>
      {/*
      <Link href='#pricing' className='transition-colors hover:text-foreground' scroll>
        Pricing
      </Link>
      <button
        onClick={handleEnterpriseClick}
        className='transition-colors hover:text-foreground'
        type='button'
        aria-label='Contact for Enterprise pricing'
      >
        Enterprise
      </button>
      */}
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
            {brand.name} Home
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
          {variant === 'landing' && !hideAuthButtons && hasResolvedRegistrationMode && (
            <Separator orientation='vertical' className='hidden h-6 md:block' />
          )}

          {!hideAuthButtons &&
            hasResolvedRegistrationMode &&
            registrationPrimaryHref &&
            registrationPrimaryLabel && (
              <div className='hidden items-center gap-2 md:flex'>
                {showStandaloneLogin ? (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleLoginClick}
                    className='rounded-md text-base'
                  >
                    Login
                  </Button>
                ) : null}
                <Button
                  size='sm'
                  onClick={
                    registrationPrimaryHref === '/login'
                      ? navigateToLogin
                      : () => router.push(registrationPrimaryHref)
                  }
                  className='rounded-md text-base'
                >
                  {registrationPrimaryLabel}
                </Button>
              </div>
            )}

          {variant === 'landing' && (
            <DropdownMenu>
              <DropdownMenuTrigger className='md:hidden' asChild>
                <Button variant='outline' size='icon'>
                  <MenuIcon className='h-5 w-5' />
                  <span className='sr-only'>Menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className='w-64' align='end'>
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    <Link
                      href='https://docs.tradinggoose.ai'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='w-full'
                      prefetch={false}
                    >
                      Docs
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href='/blog' className='w-full' prefetch={false}>
                      Blog
                    </Link>
                  </DropdownMenuItem>
                  {/*
                  <DropdownMenuItem>
                    <Link href='#pricing' scroll className='w-full'>
                      Pricing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleEnterpriseClick}>Enterprise</DropdownMenuItem>
                  */}
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
                  {!hideAuthButtons &&
                  hasResolvedRegistrationMode &&
                  registrationPrimaryHref &&
                  registrationPrimaryLabel ? (
                    <>
                      <DropdownMenuSeparator />
                      {showStandaloneLogin ? (
                        <DropdownMenuItem className='!bg-transparent'>
                          <Button
                            variant='ghost'
                            className='w-full justify-start rounded-lg'
                            size='sm'
                            onClick={handleLoginClick}
                          >
                            Login
                          </Button>
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className='!bg-transparent'>
                        <Button
                          className='w-full justify-start rounded-lg'
                          size='sm'
                          onClick={
                            registrationPrimaryHref === '/login'
                              ? navigateToLogin
                              : () => router.push(registrationPrimaryHref)
                          }
                        >
                          {registrationPrimaryLabel}
                        </Button>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </nav>
  )
}
