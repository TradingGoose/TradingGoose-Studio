'use client'

import React from 'react'
import ReactMarkdown from 'react-markdown'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { inter } from '@/app/fonts/inter'
import { soehne } from '@/app/fonts/soehne/soehne'
import type { ChangelogEntry } from './changelog-content'

type Props = { initialEntries: ChangelogEntry[] }

function sanitizeContent(body: string): string {
  return body.replace(/&nbsp/g, '')
}

function stripContributors(body: string): string {
  let output = body
  output = output.replace(
    /(^|\n)#{1,6}\s*Contributors\s*\n[\s\S]*?(?=\n\s*\n|\n#{1,6}\s|$)/gi,
    '\n'
  )
  output = output.replace(
    /(^|\n)\s*(?:\*\*|__)?\s*Contributors\s*(?:\*\*|__)?\s*:?\s*\n[\s\S]*?(?=\n\s*\n|\n#{1,6}\s|$)/gi,
    '\n'
  )
  output = output.replace(
    /(^|\n)[-*+]\s*(?:@[A-Za-z0-9-]+(?:\s*,\s*|\s+))+@[A-Za-z0-9-]+\s*(?=\n)/g,
    '\n'
  )
  output = output.replace(
    /(^|\n)\s*(?:@[A-Za-z0-9-]+(?:\s*,\s*|\s+))+@[A-Za-z0-9-]+\s*(?=\n)/g,
    '\n'
  )
  return output
}

function isContributorsLabel(nodeChildren: React.ReactNode): boolean {
  return /^\s*contributors\s*:?\s*$/i.test(String(nodeChildren))
}

function stripPrReferences(body: string): string {
  return body.replace(/\s*\(\s*\[#\d+\]\([^)]*\)\s*\)/g, '').replace(/\s*\(\s*#\d+\s*\)/g, '')
}

function cleanMarkdown(body: string): string {
  const sanitized = sanitizeContent(body)
  const withoutContribs = stripContributors(sanitized)
  const withoutPrs = stripPrReferences(withoutContribs)
  return withoutPrs
}

function extractMentions(body: string): string[] {
  const matches = body.match(/@([A-Za-z0-9-]+)/g) ?? []
  return Array.from(new Set(matches.map((m) => m.slice(1))))
}

export default function ChangelogList({ initialEntries }: Props) {
  const [entries, setEntries] = React.useState<ChangelogEntry[]>(initialEntries)
  const [page, setPage] = React.useState<number>(1)
  const [loading, setLoading] = React.useState<boolean>(false)
  const [done, setDone] = React.useState<boolean>(false)

  const loadMore = async () => {
    if (loading || done) return
    setLoading(true)
    try {
      const nextPage = page + 1
      const res = await fetch(
        `https://api.github.com/repos/TradingGoose/TradingGoose-Studio/releases?per_page=10&page=${nextPage}`,
        { headers: { Accept: 'application/vnd.github+json' } }
      )
      const releases: any[] = await res.json()
      const mapped: ChangelogEntry[] = (releases || [])
        .filter((r) => !r.prerelease)
        .map((r) => ({
          tag: r.tag_name,
          title: r.name || r.tag_name,
          content: sanitizeContent(String(r.body || '')),
          date: r.published_at,
          url: r.html_url,
          contributors: extractMentions(String(r.body || '')),
        }))

      if (mapped.length === 0) {
        setDone(true)
      } else {
        setEntries((prev) => [...prev, ...mapped])
        setPage(nextPage)
      }
    } catch {
      setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {entries.map((entry) => (
        <div key={entry.tag} className='relative flex justify-end gap-2'>
          {/* Left: sticky version + date (desktop) */}
          <div className='sticky top-19 flex w-36 flex-col items-end gap-2 self-start pb-4 max-md:hidden'>
            <Badge className='flex w-auto justify-end rounded-sm text-sm font-medium'>
              {entry.tag}
            </Badge>
            <div className={`${inter.className} text-right text-sm text-muted-foreground`}>
              {new Date(entry.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </div>
            {entry.contributors && entry.contributors.length > 0 && (
              <div className='-space-x-2 flex pt-1'>
                {entry.contributors.slice(0, 5).map((contributor) => (
                  <a
                    key={contributor}
                    href={`https://github.com/${contributor}`}
                    target='_blank'
                    rel='noreferrer noopener'
                    aria-label={`View @${contributor} on GitHub`}
                    title={`@${contributor}`}
                    className='block'
                  >
                    <Avatar className='size-5 ring-2 ring-background'>
                      <AvatarImage
                        src={`https://avatars.githubusercontent.com/${contributor}`}
                        alt={`@${contributor}`}
                        className='hover:z-10'
                      />
                      <AvatarFallback className='text-[8px]'>
                        {contributor.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Center: dot + line */}
          <div className='flex flex-col items-center'>
            <div className='sticky top-19 flex size-6 items-center justify-center max-sm:top-5'>
              <span className='flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary/20'>
                <span className='size-3 rounded-full bg-primary' />
              </span>
            </div>
            <span className='-mt-2.5 w-px flex-1 border' />
          </div>

          {/* Right: content */}
          <div className='flex flex-1 flex-col gap-4 pb-11 pl-3 md:pl-6 lg:pl-9'>
            {/* Mobile version + date */}
            <div className='flex flex-col gap-2 md:hidden'>
              <div className='flex items-center gap-2'>
                <Badge className='flex rounded-sm font-medium'>{entry.tag}</Badge>
                {entry.contributors && entry.contributors.length > 0 && (
                  <div className='-space-x-2 flex'>
                    {entry.contributors.slice(0, 3).map((contributor) => (
                      <a
                        key={contributor}
                        href={`https://github.com/${contributor}`}
                        target='_blank'
                        rel='noreferrer noopener'
                        className='block'
                      >
                        <Avatar className='size-5 ring-2 ring-background'>
                          <AvatarImage
                            src={`https://avatars.githubusercontent.com/${contributor}`}
                            alt={`@${contributor}`}
                          />
                          <AvatarFallback className='text-[8px]'>
                            {contributor.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className={`${inter.className} text-sm text-muted-foreground`}>
                {new Date(entry.date).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>

            {/* Release content */}
            <div
              className={`${inter.className} prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-headings:text-foreground prose-p:text-muted-foreground prose-a:no-underline hover:prose-a:underline`}
            >
              <ReactMarkdown
                components={{
                  h2: ({ children, ...props }) =>
                    isContributorsLabel(children) ? null : (
                      <h3
                        className={`${soehne.className} mt-5 mb-2 font-medium text-[13px] text-foreground tracking-tight`}
                        {...props}
                      >
                        {children}
                      </h3>
                    ),
                  h3: ({ children, ...props }) =>
                    isContributorsLabel(children) ? null : (
                      <h4
                        className={`${soehne.className} mt-4 mb-1 font-medium text-[13px] text-foreground tracking-tight`}
                        {...props}
                      >
                        {children}
                      </h4>
                    ),
                  ul: ({ children, ...props }) => (
                    <ul className='mt-2 mb-3 space-y-1.5' {...props}>
                      {children}
                    </ul>
                  ),
                  li: ({ children, ...props }) => {
                    const text = String(children)
                    if (/^\s*contributors\s*:?\s*$/i.test(text)) return null
                    return (
                      <li className='text-[13px] text-muted-foreground leading-relaxed' {...props}>
                        {children}
                      </li>
                    )
                  },
                  p: ({ children, ...props }) =>
                    /^\s*contributors\s*:?\s*$/i.test(String(children)) ? null : (
                      <p
                        className='mb-3 text-[13px] text-muted-foreground leading-relaxed'
                        {...props}
                      >
                        {children}
                      </p>
                    ),
                  strong: ({ children, ...props }) => (
                    <strong className='font-medium text-foreground' {...props}>
                      {children}
                    </strong>
                  ),
                  code: ({ children, ...props }) => (
                    <code
                      className='rounded bg-muted px-1 py-0.5 font-mono text-foreground text-xs'
                      {...props}
                    >
                      {children}
                    </code>
                  ),
                  img: () => null,
                  a: ({ className, ...props }: any) => (
                    <a
                      {...props}
                      className={`underline ${className ?? ''}`}
                      target='_blank'
                      rel='noreferrer'
                    />
                  ),
                }}
              >
                {cleanMarkdown(entry.content)}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      ))}

      {!done && (
        <div className='pl-44 max-md:pl-10'>
          <button
            type='button'
            onClick={loadMore}
            disabled={loading}
            className='rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-card disabled:opacity-60'
          >
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  )
}
