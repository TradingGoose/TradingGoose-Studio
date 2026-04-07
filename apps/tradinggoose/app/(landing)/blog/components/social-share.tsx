'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, LinkIcon } from 'lucide-react'
import {
  xIcon as XIcon,
  LinkedInIcon,
  RedditIcon,
  FacebookIcon,
} from '@/components/icons/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface SocialShareProps {
  url: string
  text?: string
}

export default function SocialShare({ url, text }: SocialShareProps) {
  const [copied, setCopied] = useState(false)
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
      icon: <XIcon className="h-5 w-5 text-foreground" aria-hidden="true" />,
    },
    {
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      label: 'Facebook',
      icon: <FacebookIcon className="h-5 w-5 text-[#1877F2]" aria-hidden="true" />,
    },
    {
      href: `https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedText}`,
      label: 'LinkedIn',
      icon: <LinkedInIcon className="h-5 w-5 text-[#0A66C2]" aria-hidden="true" />,
    },
    {
      href: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`,
      label: 'Reddit',
      icon: <RedditIcon className="h-5 w-5 text-[#FF5700]" aria-hidden="true" />,
    },
  ]

  return (
    <div>
      <h3 className="mb-4 font-medium text-primary">Share This Article</h3>
      <TooltipProvider delayDuration={200}>
        <div className="flex flex-wrap gap-3">
          {links.map((link) => (
            <Tooltip key={link.label}>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" asChild>
                  <Link
                    href={link.href}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    aria-label={`Share on ${link.label}`}
                  >
                    {link.icon}
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{link.label}</TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={handleCopyLink} aria-label="Copy link">
                {copied ? (
                  <Check className="h-5 w-5 text-green-500" aria-hidden="true" />
                ) : (
                  <LinkIcon className="h-5 w-5" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? 'Copied!' : 'Copy link'}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  )
}
