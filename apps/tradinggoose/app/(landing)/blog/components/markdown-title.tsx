'use client'

import ReactMarkdown from 'react-markdown'

interface MarkdownTitleProps {
  title: string
  className?: string
  as?: 'h1' | 'h2' | 'h3'
}

/** Renders inline markdown (links, bold, italic, code) with <br>/\n as line breaks. */
export default function MarkdownTitle({ title, className, as: Tag = 'h1' }: MarkdownTitleProps) {
  // Split on <br> tags and newlines to get individual lines
  const lines = title.split(/<br\s*\/?>|\n/).map((s) => s.trim()).filter(Boolean)

  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span key={i}>
          {i > 0 && <br />}
          <ReactMarkdown
            allowedElements={['p', 'a', 'strong', 'em', 'code']}
            unwrapDisallowed
            components={{
              p: ({ children }) => <>{children}</>,
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="text-primary underline underline-offset-4 hover:text-primary/80"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              code: ({ children }) => (
                <code className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-[0.85em] font-semibold">
                  {children}
                </code>
              ),
            }}
          >
            {line}
          </ReactMarkdown>
        </span>
      ))}
    </Tag>
  )
}
