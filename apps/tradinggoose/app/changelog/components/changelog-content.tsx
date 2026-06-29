import { BookOpen, Github, Rss } from 'lucide-react'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import { localizeDocsUrl, type LocaleCode } from '@/i18n/utils'
import ChangelogList from './timeline-list'
import type { PublicCopy } from '@/i18n/public-copy'

export interface ChangelogEntry {
  tag: string
  title: string
  content: string
  date: string
  url: string
  contributors?: string[]
}

function extractMentions(body: string): string[] {
  const matches = body.match(/@([A-Za-z0-9-]+)/g) ?? []
  const uniq = Array.from(new Set(matches.map((m) => m.slice(1))))
  return uniq
}

type ChangelogCopy = PublicCopy['changelog']

interface ChangelogContentProps {
  copy: ChangelogCopy
  locale: LocaleCode
}

export default async function ChangelogContent({ copy, locale }: ChangelogContentProps) {
  let entries: ChangelogEntry[] = []

  try {
    const res = await fetch(
      'https://api.github.com/repos/tradinggoose/tradinggoose-studio/releases?per_page=10&page=1',
      {
        headers: { Accept: 'application/vnd.github+json' },
        next: { revalidate: 3600 },
      }
    )
    const releases: any[] = await res.json()
    entries = (releases || [])
      .filter((r) => !r.prerelease)
      .map((r) => ({
        tag: r.tag_name,
        title: r.name || r.tag_name,
        content: String(r.body || ''),
        date: r.published_at,
        url: r.html_url,
        contributors: extractMentions(String(r.body || '')),
      }))
  } catch (err) {
    entries = []
  }

  return (
    <div className='bg-background'>
      <div className='relative grid md:grid-cols-2'>
        {/* Left intro panel */}
        <div
          className='md:absolute relative md:top-12 md:h-[95vh] overflow-hidden border-border border-b px-6 py-16 sm:px-10 md:sticky md:overflow-hidden md:border-r md:border-b-0 md:px-12 md:py-24'
        >
          <div
            className='pointer-events-none absolute inset-0 z-0'
            style={{
              maskImage:
                'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent, black 30%, black 70%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
              maskComposite: 'intersect',
              WebkitMaskComposite: 'destination-in',
            }}
          >
            <BackgroundRippleEffect cellSize={60} rows={20} cols={15} maskClassName='' interactive />
          </div>

          <div className='relative mx-auto h-full max-w-xl md:flex md:flex-col md:justify-center'>
            <h1
              className={`${soehne.className} mt-6 font-semibold text-4xl tracking-tight sm:text-5xl`}
            >
              {copy.pageTitle}
            </h1>
            <p className={`${inter.className} mt-4 text-muted-foreground text-sm`}>
              {copy.description} {copy.intro}
            </p>
            <p className={`${inter.className} mt-3 text-muted-foreground text-sm`}>
              TradingGoose Studio is updated continuously to reflect evolving algorithmic trading
              standards. According to the{' '}
              <a
                href='https://www.sec.gov/'
                rel='noopener noreferrer'
                target='_blank'
                className='underline hover:text-foreground'
              >
                U.S. Securities and Exchange Commission
              </a>
              , algorithmic trading now accounts for over 60–73% of all U.S. equity volume. Each
              release below addresses performance, compliance-adjacent tooling, and
              user-requested improvements.
            </p>
            <hr className='mt-6 border-border' />

            <div className='mt-6 flex flex-wrap items-center gap-3 text-sm'>
              <a
                href='https://github.com/tradinggoose/tradinggoose-studio/releases'
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex bg-foreground text-background items-center gap-2 rounded-md border border-border px-3 py-1.5 hover:bg-muted-foreground'
              >
                <Github className='h-4 w-4' />
                {copy.viewOnGitHub}
              </a>
              <a
                href={localizeDocsUrl(locale)}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 bg-card hover:bg-muted'
              >
                <BookOpen className='h-4 w-4' />
                {copy.documentation}
              </a>
              <a
                href='/changelog.xml'
                className='inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 bg-card hover:bg-muted'
              >
                <Rss className='h-4 w-4' />
                {copy.rssFeed}
              </a>
            </div>
          </div>
        </div>

        {/* Right timeline */}
        <div className='relative px-4 py-10 sm:px-6 md:px-8 md:py-12'>
          <div className='relative max-w-2xl pl-8'>
            <blockquote className='mb-8 border-l-2 border-primary pl-4 text-sm text-muted-foreground italic'>
              <p>
                &ldquo;Latency reduction in order routing can improve fill rates by up to 15% in
                high-frequency strategies.&rdquo;
              </p>
              <cite className='mt-1 block not-italic text-xs'>
                — Journal of Financial Markets, 2023
              </cite>
            </blockquote>
            <p className='mb-8 text-sm text-muted-foreground'>
              Improved backtesting engine aligns with{' '}
              <a
                href='https://www.cftc.gov/'
                rel='noopener noreferrer'
                target='_blank'
                className='underline hover:text-foreground'
              >
                CFTC
              </a>
              -recognized best practices for historical simulation accuracy.
            </p>
            <ChangelogList initialEntries={entries} copy={copy} locale={locale} />
          </div>
        </div>
      </div>
    </div>
  )
}
