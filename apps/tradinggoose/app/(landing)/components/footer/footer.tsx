import Image from 'next/image'
import Link from 'next/link'
import { DiscordIcon, GithubIcon } from '@/components/icons/icons'
import FooterHoverText from '@/app/(landing)/components/footer/footer-hover-text'
import { soehne } from '@/app/fonts/soehne/soehne'

type FooterLink = {
  label: string
  href: string
  external: boolean
}

const productLinks: FooterLink[] = [
  { label: 'Docs', href: 'https://docs.tradinggoose.ai', external: true },
  { label: 'Widgets', href: 'https://docs.tradinggoose.ai/widgets', external: true },
  { label: 'Blocks', href: 'https://docs.tradinggoose.ai/blocks', external: true },
  { label: 'Tools', href: 'https://docs.tradinggoose.ai/tools', external: true },
  //{ label: 'Pricing', href: '/#pricing', external: false },
  { label: 'Changelog', href: '/changelog', external: false },
  //{ label: 'Enterprise', href: '', external: true },
]

const legalLinks: FooterLink[] = [
  { label: 'Privacy Policy', href: '/privacy', external: false },
  { label: 'Licenses', href: '/licenses', external: false },
  { label: 'Terms of Service', href: '/terms', external: false },
]

interface FooterProps {
  fullWidth?: boolean
}

export default function Footer({ fullWidth = false }: FooterProps) {
  const maxWidthClass = fullWidth ? 'max-w-[90vw]' : 'max-w-7xl'

  return (
    <footer className={`${soehne.className} relative`}>
      <div
        className={`relative mx-auto flex ${maxWidthClass} flex-col gap-6 px-4 pt-6 pb-6 sm:px-6 sm:pt-8 lg:px-8`}
      >
        <div className='relative z-10 flex flex-col gap-8 text-muted-foreground sm:gap-10 lg:flex-row lg:items-end lg:justify-between'>
          <div className='flex max-w-[30rem] flex-col gap-5 max-sm:items-center max-sm:text-center'>
            <Link
              href='/'
              aria-label='TradingGoose Studio home'
              className='flex items-center gap-3'
              prefetch={false}
            >
              <Image
                src='/icon.svg'
                alt=''
                width={28}
                height={28}
                className='h-7 w-7'
                priority
                quality={100}
              />
              <span className='font-semibold text-foreground text-xl'>TradingGoose Studio</span>
            </Link>

            <p className='max-w-[28rem] text-balance text-sm leading-relaxed'>
              AI workflow platform for technical LLM trading
            </p>

            <div className='flex items-center gap-4 max-sm:justify-center'>
              <a
                href='https://discord.gg/wavf5JWhuT'
                target='_blank'
                rel='noopener noreferrer'
                aria-label='Discord'
                className='transition-colors duration-300 hover:text-foreground'
              >
                <DiscordIcon className='h-5 w-5' aria-hidden='true' />
              </a>
              <a
                href='https://github.com/TradingGoose/TradingGoose-Studio'
                target='_blank'
                rel='noopener noreferrer'
                aria-label='GitHub'
                className='transition-colors duration-300 hover:text-foreground'
              >
                <GithubIcon className='h-5 w-5' aria-hidden='true' />
              </a>
            </div>

            <p className='max-w-[28rem] text-balance font-light text-xs leading-relaxed'>
              {`© ${new Date().getFullYear()} TradingGoose Studio. Built for visual trading workflows.`}
            </p>
          </div>

          <div className='order-first text-sm space-y-20 max-sm:text-center sm:max-w-[28rem] sm:self-start lg:order-none lg:items-end'>
            <div className='grid grid-cols-3 gap-x-8 gap-y-3 sm:grid-cols-4 sm:gap-x-12'>
              {productLinks.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='transition-colors duration-300 hover:text-foreground'
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    className='transition-colors duration-300 hover:text-foreground'
                    prefetch={false}
                  >
                    {link.label}
                  </Link>
                )
              )}
            </div>

            <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs max-sm:justify-center'>
              {legalLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className='transition-colors duration-300 hover:text-foreground'
                  prefetch={false}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div
          aria-hidden='true'
          className='-translate-x-1/2 -translate-y-8 -pt-8 sm:-pt-16 absolute left-1/2 z-0 hidden w-full max-w-70 overflow-hidden sm:block'
        >
          <FooterHoverText text='HONK!' />
          <div
            className='pointer-events-none absolute inset-x-0 bottom-0 h-1/3'
            style={{
              background: 'linear-gradient(to bottom, transparent, hsl(var(--background)))',
            }}
          />
        </div>
      </div>
    </footer>
  )
}
