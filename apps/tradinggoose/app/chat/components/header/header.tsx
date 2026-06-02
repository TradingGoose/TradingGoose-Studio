'use client'

import Image from 'next/image'
import { GithubIcon } from '@/components/icons/icons'
import { Link } from '@/i18n/navigation'
import { formatTemplate } from '@/i18n/client-messages'
import type { ChatMessages } from '@/i18n/message-types'
import { inter } from '@/app/fonts/inter'

interface ChatHeaderProps {
  chatConfig: {
    title?: string
    customizations?: {
      headerText?: string
      logoUrl?: string
      imageUrl?: string
      primaryColor?: string
    }
  } | null
  starCount: string
  copy: ChatMessages
}

export function ChatHeader({ chatConfig, starCount, copy }: ChatHeaderProps) {
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl
  const title = chatConfig?.customizations?.headerText || chatConfig?.title || copy.header.titleFallback
  const brand = copy.header.brandName

  return (
    <nav
      aria-label={copy.header.navigationAriaLabel}
      className='flex w-full items-center justify-between px-4 pt-[12px] pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px] md:pt-[16px]'
    >
      <div className='flex items-center gap-[34px]'>
        <div className='flex items-center gap-3'>
          {customImage && (
            <Image
              src={customImage}
              alt={formatTemplate(copy.header.logoAlt, { title })}
              width={24}
              height={24}
              className='h-6 w-6 rounded-md object-cover'
            />
          )}
          <h2 className={`${inter.className} font-medium text-[18px] text-foreground`}>
            {title}
          </h2>
        </div>
      </div>

      <div className='flex items-center gap-[16px]'>
        <a
          href='https://github.com/TradingGoose/TradingGoose-Studio'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 text-[16px] text-muted-foreground transition-colors hover:text-foreground'
          aria-label={formatTemplate(copy.header.githubRepositoryAriaLabel, { stars: starCount })}
        >
          <GithubIcon className='h-[16px] w-[16px]' aria-hidden='true' />
          <span className={`${inter.className}`} aria-live='polite'>
            {starCount}
          </span>
        </a>
        <Link
          href='/'
          aria-label={formatTemplate(copy.header.homeAriaLabel, { brand })}
        >
          <Image
            src='/favicon/goose.png'
            alt={brand}
            width={24}
            height={24}
            className='h-6 w-6'
            priority
            loading='eager'
            quality={100}
          />
        </Link>
      </div>
    </nav>
  )
}
