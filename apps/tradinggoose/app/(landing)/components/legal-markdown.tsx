import ReactMarkdown from 'react-markdown'
import type { ComponentProps } from 'react'
import { soehne } from '@/app/fonts/soehne/soehne'

const legalMarkdownComponents = {
  h2: ({ children, ...props }: ComponentProps<'h2'>) => (
    <h2
      className={`${soehne.className} mb-4 font-semibold text-2xl`}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: ComponentProps<'h3'>) => (
    <h3 className='mb-2 font-medium text-xl' {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: ComponentProps<'p'>) => (
    <p className='mb-4' {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: ComponentProps<'ul'>) => (
    <ul className='mb-4 list-disc space-y-2 pl-6' {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: ComponentProps<'ol'>) => (
    <ol className='mb-4 list-decimal space-y-2 pl-6' {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: ComponentProps<'li'>) => (
    <li {...props}>{children}</li>
  ),
  a: ({ children, href, ...props }: ComponentProps<'a'>) => {
    const isExternal = typeof href === 'string' && /^https?:\/\//.test(href)

    return (
      <a
        className='text-primary underline hover:text-primary-hover'
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {children}
      </a>
    )
  },
  code: ({ children, ...props }: ComponentProps<'code'>) => (
    <code className='rounded bg-muted px-1 py-0.5 font-mono text-xs' {...props}>
      {children}
    </code>
  ),
  strong: ({ children, ...props }: ComponentProps<'strong'>) => (
    <strong {...props}>{children}</strong>
  ),
}

interface LegalMarkdownProps {
  body: string
}

export function LegalMarkdown({ body }: LegalMarkdownProps) {
  return <ReactMarkdown components={legalMarkdownComponents}>{body}</ReactMarkdown>
}
