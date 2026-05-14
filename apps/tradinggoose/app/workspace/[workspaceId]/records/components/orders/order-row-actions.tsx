'use client'

import type React from 'react'
import { useState } from 'react'
import { Check, Copy, ExternalLink, FileSearch, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { RecordsOrder } from '@/hooks/queries/records-orders'
import { orderIdentifier } from './order-formatters'

interface OrderRowActionsProps {
  order: RecordsOrder
  onOpenOrder: (order: RecordsOrder) => void
  onOpenLog: (order: RecordsOrder) => void
  onOpenProvider: (order: RecordsOrder) => void
}

export function OrderRowActions({
  order,
  onOpenOrder,
  onOpenLog,
  onOpenProvider,
}: OrderRowActionsProps) {
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
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            onClick={(event) => {
              stop(event)
              onOpenOrder(order)
            }}
          >
            <PanelRightOpen className='h-4 w-4' />
            <span className='sr-only'>Order data</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Order data</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            disabled={!order.logId}
            onClick={(event) => {
              stop(event)
              onOpenLog(order)
            }}
          >
            <FileSearch className='h-4 w-4' />
            <span className='sr-only'>Log detail</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{order.logId ? 'Log detail' : 'No linked log'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size='icon' variant='ghost' className='h-8 w-8' onClick={handleCopy}>
            {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
            <span className='sr-only'>Copy order id</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Copy order id</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            onClick={(event) => {
              stop(event)
              onOpenProvider(order)
            }}
          >
            <ExternalLink className='h-4 w-4' />
            <span className='sr-only'>Refresh provider detail</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh provider detail</TooltipContent>
      </Tooltip>
    </div>
  )
}
