'use client'

import type { MouseEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { MenuIcon } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { GithubIcon } from '@/components/icons'
import { useBrandConfig } from '@/lib/branding/branding'
import { createLogger } from '@/lib/logs/console/logger'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'
import { soehne } from '@/app/fonts/soehne/soehne'

const logger = createLogger('nav')

interface NavProps {
  hideAuthButtons?: boolean
  variant?: 'landing' | 'auth' | 'legal'
}

export default function Nav({ hideAuthButtons = false, variant = 'landing' }: NavProps = {}) {
  const [githubStars, setGithubStars] = useState('17.4k')
  const router = useRouter()
  const brand = useBrandConfig()

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

  const handleLoginClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      router.push('/login?reauth=1')
    },
    [router]
  )

  const handleEnterpriseClick = useCallback(() => {
    window.open('https://form.typeform.com/to/jqCO12pF', '_blank', 'noopener,noreferrer')
  }, [])

  const desktopNavLinks = variant === 'landing' && (
    <div className='text-muted-foreground hidden items-center gap-6 text-sm font-medium md:flex'>
      <Link
        href='https://docs.sim.ai'
        target='_blank'
        rel='noopener noreferrer'
        className='transition-colors hover:text-foreground'
        prefetch={false}
      >
        Docs
      </Link>
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
      <a
        href='https://github.com/simstudioai/sim'
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
      className={`${soehne.className} sticky inset-x-0 top-0 z-50 w-full border-b border-border bg-background/55 backdrop-blur supports-[backdrop-filter]:bg-background/55`}
      itemScope
      itemType='https://schema.org/SiteNavigationElement'
    >
      <div className='mx-auto flex w-full items-center justify-between gap-4 px-4 py-2 sm:px-6 md:px-10'>
        <Link
          href='/?from=nav'
          aria-label={`${brand.name} home`}
          itemProp='url'
          className='flex items-center gap-2'
        >
          <span itemProp='name' className='sr-only'>
            {brand.name} Home
          </span>
          <span className='flex items-center gap-2 text-[18px] font-semibold tracking-tight text-foreground' aria-hidden='true'>
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
          {variant === 'landing' && <Separator orientation='vertical' className='hidden h-6 md:block' />}

          {!hideAuthButtons && (
            <>
              <Button
                variant='ghost'
                size='sm'
                className='hidden rounded-md text-base font-medium text-foreground md:inline-flex'
                onClick={handleLoginClick}
                type='button'
                aria-label='Log in to your account'
              >
                Log in
              </Button>
              <Button
                className='hidden rounded-md text-base text-black md:inline-flex'
                size='sm'
                asChild
                aria-label='Get started with Sim - Sign up for free'
              >
                <Link href='/signup' prefetch>
                  Get started
                </Link>
              </Button>
            </>
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
                      href='https://docs.sim.ai'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='w-full'
                      prefetch={false}
                    >
                      Docs
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link href='#pricing' scroll className='w-full'>
                      Pricing
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleEnterpriseClick}>
                    Enterprise
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <a
                      href='https://github.com/simstudioai/sim'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='flex w-full items-center gap-2'
                    >
                      <GithubIcon className='h-4 w-4' aria-hidden='true' />
                      <span aria-live='polite'>{githubStars}</span>
                    </a>
                  </DropdownMenuItem>
                  {!hideAuthButtons && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className='!bg-transparent'>
                        <Button className='w-full justify-start' variant='ghost' size='sm' onClick={handleLoginClick} aria-label='Log in to your account'>
                          Log in
                        </Button>
                      </DropdownMenuItem>
                      <DropdownMenuItem className='!bg-transparent'>
                        <Button className='w-full justify-start rounded-lg' size='sm' asChild aria-label='Get started with Sim - Sign up for free'>
                          <Link href='/signup' prefetch>
                            Get started
                          </Link>
                        </Button>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </nav>
  )
}
