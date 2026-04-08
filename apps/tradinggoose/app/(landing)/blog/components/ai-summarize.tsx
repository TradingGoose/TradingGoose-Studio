'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { OpenAIIcon, AnthropicIcon, GeminiIcon, xAIIcon as XAIIcon } from '@/components/icons/provider-icons'
import { PerplexityIcon } from '@/components/icons/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface AiSummarizeProps {
  path: string
  title: string
}

export default function AiSummarize({ path, title }: AiSummarizeProps) {
  const [url, setUrl] = useState(path)

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`)
  }, [path])

  const encodedQuery = encodeURIComponent(`Please summarize this article: ${title} - ${url}`)

  const platforms = [
    {
      href: `https://chat.openai.com/?q=${encodedQuery}`,
      label: 'ChatGPT',
      icon: <OpenAIIcon className="h-5 w-5" aria-hidden="true" />,
    },
    {
      href: `https://claude.ai/new?q=${encodedQuery}`,
      label: 'Claude',
      icon: <AnthropicIcon className="h-5 w-5" aria-hidden="true" />,
    },
    {
      href: `https://x.com/i/grok?text=${encodedQuery}`,
      label: 'Grok',
      icon: <XAIIcon className="h-5 w-5" aria-hidden="true" />,
    },
    {
      href: `https://www.perplexity.ai/?q=${encodedQuery}`,
      label: 'Perplexity',
      icon: <PerplexityIcon className="h-5 w-5" aria-hidden="true" />,
    },
    {
      href: `https://www.google.com/search?udm=50&aep=11&q=${encodedQuery}`,
      label: 'Gemini',
      icon: <GeminiIcon className="h-5 w-5" aria-hidden="true" />,
    },
  ]

  return (
    <div>
      <h3 className="mb-4 font-medium text-primary">Summarize with AI</h3>
      <TooltipProvider delayDuration={200}>
        <div className="flex flex-wrap gap-3">
          {platforms.map((platform) => (
            <Tooltip key={platform.label}>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" asChild>
                  <Link
                    href={platform.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Summarize with ${platform.label}`}
                  >
                    {platform.icon}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{platform.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}
