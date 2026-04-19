'use client'

import Image from 'next/image'
import Link from 'next/link'
import { GithubIcon } from '@/components/icons/icons'
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
}

export function ChatHeader({ chatConfig, starCount }: ChatHeaderProps) {
  const customImage = chatConfig?.customizations?.imageUrl || chatConfig?.customizations?.logoUrl

  return (
    <nav
      aria-label='Chat navigation'
      className={`flex w-full items-center justify-between px-4 pt-[12px] pb-[21px] sm:px-8 sm:pt-[8.5px] md:px-[44px] md:pt-[16px]`}
    >
      <div className='flex items-center gap-[34px]'>
        <div className='flex items-center gap-3'>
          {customImage && (
            <Image
              src={customImage}
              alt={`${chatConfig?.title || 'Chat'} logo`}
              width={24}
              height={24}
              className='h-6 w-6 rounded-md object-cover'
            />
          )}
          <h2 className={`${inter.className} font-medium text-[18px] text-foreground`}>
            {chatConfig?.customizations?.headerText || chatConfig?.title || 'Chat'}
          </h2>
        </div>
      </div>

      <div className='flex items-center gap-[16px]'>
        <a
          href='https://github.com/TradingGoose/TradingGoose-Studio'
          target='_blank'
          rel='noopener noreferrer'
          className='flex items-center gap-2 text-[16px] text-muted-foreground transition-colors hover:text-foreground'
          aria-label={`GitHub repository - ${starCount} stars`}
        >
          <GithubIcon className='h-[16px] w-[16px]' aria-hidden='true' />
          <span className={`${inter.className}`} aria-live='polite'>
            {starCount}
          </span>
        </a>
        <Link
          href='https://tradinggoose.ai'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='TradingGoose home'
        >
          <Image
            src='/favicon/goose.png'
            alt='TradingGoose'
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
