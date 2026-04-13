'use client'

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

const logger = createLogger('nav')

interface NavProps {
  hideAuthButtons?: boolean
  variant?: 'landing' | 'auth'
  registrationMode?: RegistrationMode | null
}

export default function Nav({
  hideAuthButtons = false,
  variant = 'landing',
  registrationMode = null,
}: NavProps = {}) {
  const [githubStars, setGithubStars] = useState('0')
  const router = useRouter()
  const brand = useBrandConfig()
  const hasResolvedRegistrationMode = registrationMode !== null
  const registrationPrimaryHref = registrationMode
    ? getRegistrationPrimaryHref(registrationMode)
    : null
  const registrationPrimaryLabel = registrationMode
    ? getRegistrationPrimaryLabel(registrationMode)
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

  const navigateToLogin = useCallback(() => {
    router.push('/login?reauth=1')
  }, [router])

  const navigateToPrimaryCta = useCallback(() => {
    if (!registrationPrimaryHref) {
      return
    }

    router.push(registrationPrimaryHref)
  }, [registrationPrimaryHref, router])

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
          <Button
            variant='ghost'
            size='sm'
            onClick={navigateToLogin}
            className='rounded-md text-base'
          >
            Login
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
          {variant === 'landing' && !hideAuthButtons && hasResolvedRegistrationMode ? (
            <Separator orientation='vertical' className='hidden h-6 md:block' />
          ) : null}

          {registrationActions ? <div className='hidden items-center gap-2 md:flex'>{registrationActions}</div> : null}

          {variant === 'landing' ? (
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
