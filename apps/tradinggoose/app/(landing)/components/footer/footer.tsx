import Image from 'next/image'
import { getLocale } from 'next-intl/server'
import { DiscordIcon, GithubIcon } from '@/components/icons/icons'
import { getBrandConfig } from '@/lib/branding/branding'
import FooterHoverText from '@/app/(landing)/components/footer/footer-hover-text'
import { soehne } from '@/app/fonts/soehne/soehne'
import { Link } from '@/i18n/navigation'
import { getPublicCopy } from '@/i18n/public-copy'
import { localizeDocsUrl, type LocaleCode } from '@/i18n/utils'

type FooterLinkKey =
  | 'docs'
  | 'blog'
  | 'widgets'
  | 'indicators'
  | 'blocks'
  | 'tools'
  | 'changelog'
  | 'privacy'
  | 'licenses'
  | 'terms'

type FooterLink = {
  key: FooterLinkKey
  href: string
  external: boolean
}

function getProductLinks(locale: LocaleCode): FooterLink[] {
  return [
    { key: 'docs', href: localizeDocsUrl(locale), external: true },
    { key: 'blog', href: '/blog', external: false },
    { key: 'widgets', href: localizeDocsUrl(locale, '/widgets'), external: true },
    { key: 'indicators', href: localizeDocsUrl(locale, '/indicators'), external: true },
    { key: 'blocks', href: localizeDocsUrl(locale, '/blocks'), external: true },
    { key: 'tools', href: localizeDocsUrl(locale, '/tools'), external: true },
    //{ label: 'Pricing', href: '/#pricing', external: false },
    { key: 'changelog', href: '/changelog', external: false },
    //{ label: 'Enterprise', href: '', external: true },
  ]
}

const legalLinks: FooterLink[] = [
  { key: 'privacy', href: '/privacy', external: false },
  { key: 'licenses', href: '/licenses', external: false },
  { key: 'terms', href: '/terms', external: false },
]

interface FooterProps {
  fullWidth?: boolean
}

export default async function Footer({ fullWidth = false }: FooterProps) {
  const brand = getBrandConfig()
  const locale = (await getLocale()) as LocaleCode
  const copy = getPublicCopy(locale)
  const productLinks = getProductLinks(locale)
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
              aria-label={`${brand.name} home`}
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
              <span className='font-semibold text-foreground text-xl'>{brand.name}</span>
            </Link>

            <p className='max-w-[28rem] text-balance text-sm leading-relaxed'>
              {copy.landing.footer.description}
            </p>

            <div className='flex items-center gap-4 max-sm:justify-center'>
              <a
                href='https://discord.gg/wavf5JWhuT'
                target='_blank'
                rel='noopener noreferrer'
                aria-label={copy.landing.footer.social.discord}
                className='transition-colors duration-300 hover:text-foreground'
              >
                <DiscordIcon className='h-5 w-5' aria-hidden='true' />
              </a>
              <a
                href='https://github.com/TradingGoose/TradingGoose-Studio'
                target='_blank'
                rel='noopener noreferrer'
                aria-label={copy.landing.footer.social.github}
                className='transition-colors duration-300 hover:text-foreground'
              >
                <GithubIcon className='h-5 w-5' aria-hidden='true' />
              </a>
            </div>

            <p className='max-w-[28rem] text-balance font-light text-xs leading-relaxed'>
              {copy.landing.footer.copyright
                .replace('{{year}}', String(new Date().getFullYear()))
                .replace('{{brand}}', brand.name)}
            </p>
          </div>

          <div className='order-first space-y-16 text-sm max-sm:text-center sm:max-w-[28rem] sm:self-start lg:order-none lg:items-end'>
            <div className='grid grid-cols-3 gap-x-8 gap-y-3 sm:grid-cols-4 sm:gap-x-12'>
              {productLinks.map((link) =>
                link.external ? (
                  <a
                    key={link.key}
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='transition-colors duration-300 hover:text-foreground'
                  >
                    {copy.landing.footer.links[link.key]}
                  </a>
                ) : (
                  <Link
                    key={link.key}
                    href={link.href}
                    className='transition-colors duration-300 hover:text-foreground'
                    prefetch={false}
                  >
                    {copy.landing.footer.links[link.key]}
                  </Link>
                )
              )}
            </div>

            <div className='flex flex-wrap gap-x-4 gap-y-2 py-3 text-xs max-sm:justify-center'>
              {legalLinks.map((link) => (
                <Link
                  key={link.key}
                  href={link.href}
                  className='transition-colors duration-300 hover:text-foreground'
                  prefetch={false}
                >
                  {copy.landing.footer.links[link.key]}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div
          aria-hidden='true'
          className='-translate-x-1/2 -translate-y-8 -pt-8 sm:-pt-16 absolute left-1/2 z-0 hidden w-full max-w-70 overflow-hidden sm:block'
        >
          <FooterHoverText text={copy.landing.footer.hoverText} />
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
