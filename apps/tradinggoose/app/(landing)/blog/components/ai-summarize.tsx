'use client'

import { useEffect, useState } from 'react'
import { useMessages } from 'next-intl'
import { PerplexityIcon } from '@/components/icons/icons'
import {
  AnthropicIcon,
  GeminiIcon,
  OpenAIIcon,
  xAIIcon as XAIIcon,
} from '@/components/icons/provider-icons'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTemplate } from '@/i18n/utils'

interface AiSummarizeProps {
  path: string
  title: string
}

export default function AiSummarize({ path, title }: AiSummarizeProps) {
  const [url, setUrl] = useState(path)
  const copy = useMessages()
  const blogCopy = copy.blog

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`)
  }, [path])

  const encodedQuery = encodeURIComponent(`Please summarize this article: ${title} - ${url}`)

  const platforms = [
    {
      href: `https://chat.openai.com/?q=${encodedQuery}`,
      label: 'ChatGPT',
      icon: <OpenAIIcon className='h-5 w-5' aria-hidden='true' />,
    },
    {
      href: `https://claude.ai/new?q=${encodedQuery}`,
      label: 'Claude',
      icon: <AnthropicIcon className='h-5 w-5' aria-hidden='true' />,
    },
    {
      href: `https://x.com/i/grok?text=${encodedQuery}`,
      label: 'Grok',
      icon: <XAIIcon className='h-5 w-5' aria-hidden='true' />,
    },
    {
      href: `https://www.perplexity.ai/?q=${encodedQuery}`,
      label: 'Perplexity',
      icon: <PerplexityIcon className='h-5 w-5' aria-hidden='true' />,
    },
    {
      href: `https://www.google.com/search?udm=50&aep=11&q=${encodedQuery}`,
      label: 'Gemini',
      icon: <GeminiIcon className='h-5 w-5' aria-hidden='true' />,
    },
  ]

  return (
    <div>
      <h3 className='mb-4 font-medium text-primary'>{blogCopy.summarizeTitle}</h3>
      <TooltipProvider delay={200}>
        <div className='flex flex-wrap gap-3'>
          {platforms.map((platform) => (
            <Tooltip key={platform.label}>
              <TooltipTrigger
                render={
                  <a
                    href={platform.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={formatTemplate(blogCopy.summarizeWithPlatform, {
                      platform: platform.label,
                    })}
                    className={buttonVariants({ variant: 'outline', size: 'icon' })}
                  >
                    {platform.icon}
                  </a>
                }
              />
              <TooltipContent>{platform.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}
