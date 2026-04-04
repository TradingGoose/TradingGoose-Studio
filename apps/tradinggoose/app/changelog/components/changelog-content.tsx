import { BookOpen, Github, Rss } from 'lucide-react'
import Link from 'next/link'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import { BackgroundRippleEffect } from '@/components/ui/background-ripple-effect'
import ChangelogList from './timeline-list'

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

export default async function ChangelogContent() {
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
              Changelog
            </h1>
            <p className={`${inter.className} mt-4 text-muted-foreground text-sm`}>
              Stay up-to-date with the latest features, improvements, and bug fixes in TradingGoose.
              All changes are documented here with detailed release notes.
            </p>
            <hr className='mt-6 border-border' />

            <div className='mt-6 flex flex-wrap items-center gap-3 text-sm'>
              <Link
                href='https://github.com/tradinggoose/tradinggoose-studio/releases'
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex bg-foreground text-background items-center gap-2 rounded-md border border-border px-3 py-1.5 hover:bg-muted-foreground'
              >
                <Github className='h-4 w-4' />
                View on GitHub
              </Link>
              <Link
                href='https://docs.tradinggoose.ai'
                className='inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 bg-card hover:bg-muted'
              >
                <BookOpen className='h-4 w-4' />
                Documentation
              </Link>
              <Link
                href='/changelog.xml'
                className='inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 bg-card hover:bg-muted'
              >
                <Rss className='h-4 w-4' />
                RSS Feed
              </Link>
            </div>
          </div>
        </div>

        {/* Right timeline */}
        <div className='relative px-4 py-10 sm:px-6 md:px-8 md:py-12'>
          <div className='relative max-w-2xl pl-8'>
            <ChangelogList initialEntries={entries} />
          </div>
        </div>
      </div>
    </div>
  )
}
