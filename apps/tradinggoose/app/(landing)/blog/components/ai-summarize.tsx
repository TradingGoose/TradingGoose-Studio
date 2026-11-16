'use client'

import { useEffect, useState } from 'react'
import { useMessages } from 'next-intl'
import { buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getProviderIcon } from '@/lib/ui/provider-icon'
import { formatTemplate } from '@/i18n/utils'

interface AiSummarizeProps {
  path: string
  title: string
}

const platforms = [
  { href: 'https://chat.openai.com/?q=', label: 'ChatGPT', icon: getProviderIcon('openai') },
  { href: 'https://claude.ai/new?q=', label: 'Claude', icon: getProviderIcon('anthropic') },
  { href: 'https://x.com/i/grok?text=', label: 'Grok', icon: getProviderIcon('xai') },
  {
    href: 'https://www.perplexity.ai/?q=',
    label: 'Perplexity',
    icon: getProviderIcon('perplexity'),
  },
  {
    href: 'https://www.google.com/search?udm=50&aep=11&q=',
    label: 'Gemini',
    icon: getProviderIcon('google'),
  },
]

export default function AiSummarize({ path, title }: AiSummarizeProps) {
  const [url, setUrl] = useState(path)
  const copy = useMessages()
  const blogCopy = copy.blog

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`)
  }, [path])

  const encodedQuery = encodeURIComponent(`Please summarize this article: ${title} - ${url}`)

  return (
    <div>
      <h3 className='mb-4 font-medium text-primary'>{blogCopy.summarizeTitle}</h3>
      <TooltipProvider delay={200}>
        <div className='flex flex-wrap gap-3'>
          {platforms.map(({ href, label, icon: Icon }) => (
            <Tooltip key={label}>
              <TooltipTrigger
                render={
                  <a
                    href={`${href}${encodedQuery}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-label={formatTemplate(blogCopy.summarizeWithPlatform, {
                      platform: label,
                    })}
                    className={buttonVariants({ variant: 'outline', size: 'icon' })}
                  >
                    <Icon className='h-5 w-5' />
                  </a>
                }
              />
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )
}
