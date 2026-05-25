'use client'

import type React from 'react'
import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { orderIdentifier } from './order-formatters'

interface OrderRowActionsProps {
  order: RecordsOrder
  providerOrderDetailUrl: string | null
}

export function OrderRowActions({ order, providerOrderDetailUrl }: OrderRowActionsProps) {
  const [copied, setCopied] = useState(false)

  const stop = (event: React.MouseEvent) => event.stopPropagation()

  const handleCopy = async (event: React.MouseEvent) => {
    stop(event)
    await navigator.clipboard?.writeText(orderIdentifier(order))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className='flex items-center justify-end gap-1'>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size='icon' variant='ghost' className='h-8 w-8' onClick={handleCopy}>
            {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
            <span className='sr-only'>Copy order id</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy order id</TooltipContent>
      </Tooltip>

      {providerOrderDetailUrl ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size='icon' variant='ghost' className='h-8 w-8'>
              <a
                href={providerOrderDetailUrl}
                target='_blank'
                rel='noopener noreferrer'
                onClick={stop}
              >
                <ExternalLink className='h-4 w-4' />
                <span className='sr-only'>Open provider order detail</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open provider order detail</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
