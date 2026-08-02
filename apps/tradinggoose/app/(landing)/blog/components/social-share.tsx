'use client'

import { useEffect, useState } from 'react'
import { Check, LinkIcon } from 'lucide-react'
import { useMessages } from 'next-intl'
import { FacebookIcon, LinkedInIcon, RedditIcon, xIcon as XIcon } from '@/components/icons/icons'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTemplate } from '@/i18n/utils'

interface SocialShareProps {
  path: string
  text?: string
}

export default function SocialShare({ path, text }: SocialShareProps) {
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState(path)
  const copy = useMessages()
  const blogCopy = copy.blog

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`)
  }, [path])

  const encodedUrl = encodeURIComponent(url)
  const encodedText = encodeURIComponent(text ?? '')

  const handleCopyLink = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const links = [
    {
      href: `https://x.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      label: 'X (Twitter)',
      icon: <XIcon className='h-5 w-5 text-foreground' aria-hidden='true' />,
    },
    {
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      label: 'Facebook',
      icon: <FacebookIcon className='h-5 w-5 text-[#1877F2]' aria-hidden='true' />,
    },
    {
      href: `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedText}`,
      label: 'LinkedIn',
      icon: <LinkedInIcon className='h-5 w-5 text-[#0A66C2]' aria-hidden='true' />,
    },
    {
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`,
      label: 'Reddit',
      icon: <RedditIcon className='h-5 w-5 text-[#FF5700]' aria-hidden='true' />,
    },
  ]

  return (
    <div>
      <h3 className='mb-4 font-medium text-primary'>{blogCopy.shareTitle}</h3>
      <TooltipProvider delay={200}>
        <div className='flex flex-wrap gap-3'>
          {links.map((link) => (
            <Tooltip key={link.label}>
              <TooltipTrigger
                render={
                  <a
                    href={link.href}
                    target='_blank'
                    rel='nofollow noopener noreferrer'
                    aria-label={formatTemplate(blogCopy.shareOn, { platform: link.label })}
                    className={buttonVariants({ variant: 'outline', size: 'icon' })}
                  >
                    {link.icon}
                  </a>
                }
              />
              <TooltipContent>{link.label}</TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  onClick={handleCopyLink}
                  aria-label={blogCopy.copyLink}
                >
                  {copied ? (
                    <Check className='h-5 w-5 text-green-500' aria-hidden='true' />
                  ) : (
                    <LinkIcon className='h-5 w-5' aria-hidden='true' />
                  )}
                </Button>
              }
            />
            <TooltipContent>{copied ? blogCopy.copied : blogCopy.copyLink}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  )
}
