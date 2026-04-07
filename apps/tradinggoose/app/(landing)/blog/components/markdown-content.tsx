'use client'

import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Image from 'next/image'
import Link from 'next/link'
import { CodeBlock } from '@/components/ui/code-block'
import { createHeadingSlugger, flattenNodeText } from '../lib/heading-slugs'

interface MarkdownContentProps {
  content: string
}

export default function MarkdownContent({ content }: MarkdownContentProps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reset slugger when content changes
  const slugger = useMemo(() => createHeadingSlugger(), [content])

  return (
    <div className="blog-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, ...props }) => (
            <h1
              id={slugger(flattenNodeText(children))}
              className="mt-2 scroll-m-20 text-4xl font-bold tracking-tight"
              {...props}
            >
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2
              id={slugger(flattenNodeText(children))}
              className="mt-10 scroll-m-20 border-b pb-1 text-3xl font-semibold tracking-tight first:mt-0"
              {...props}
            >
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3
              id={slugger(flattenNodeText(children))}
              className="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight"
              {...props}
            >
              {children}
            </h3>
          ),
          h4: ({ children, ...props }) => (
            <h4
              id={slugger(flattenNodeText(children))}
              className="mt-8 scroll-m-20 text-xl font-semibold tracking-tight"
              {...props}
            >
              {children}
            </h4>
          ),
          p: ({ children, ...props }) => (
            <p className="leading-7 [&:not(:first-child)]:mt-6" {...props}>
              {children}
            </p>
          ),
          a: ({ href, children, ...props }) => {
            const isNonRoute = href ? /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href) || href.startsWith('//') : false
            if (isNonRoute) {
              return (
                <a
                  href={href}
                  className="font-medium text-primary underline underline-offset-4"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              )
            }
            return (
              <Link
                href={href ?? '#'}
                className="font-medium text-primary underline underline-offset-4"
                {...props}
              >
                {children}
              </Link>
            )
          },
          blockquote: ({ children, ...props }) => (
            <blockquote className="mt-6 border-l-2 pl-6 italic" {...props}>
              {children}
            </blockquote>
          ),
          ul: ({ children, ...props }) => (
            <ul className="my-6 ml-6 list-disc" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="my-6 ml-6 list-decimal" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="mt-2" {...props}>
              {children}
            </li>
          ),
          hr: () => <hr className="my-4 md:my-8" />,
          img: ({ src, alt }) =>
            src && typeof src === 'string' ? (
              <Image
                src={src as string}
                alt={alt ?? ''}
                width={832}
                height={468}
                className="my-8 rounded-md border"
              />
            ) : null,
          pre: ({ children }) => {
            const codeEl = children as React.ReactElement<{
              className?: string
              children?: string
            }>
            const lang = codeEl?.props?.className?.replace('language-', '') ?? ''
            const code = codeEl?.props?.children?.toString().trim() ?? ''
            return <CodeBlock code={code} language={lang} className="my-6" />
          },
          code: ({ children, className, ...props }) => {
            if (className) return <code className={className} {...props}>{children}</code>
            return (
              <code
                className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold"
                {...props}
              >
                {children}
              </code>
            )
          },
          table: ({ children, ...props }) => (
            <div className="my-6 w-full overflow-y-auto">
              <table className="w-full" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              className="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
              {...props}
            >
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
