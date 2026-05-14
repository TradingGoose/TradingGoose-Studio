'use client'

import { Check, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import type { CopilotAccessLevel } from '@/lib/copilot/access-policy'
import { cn } from '@/lib/utils'

interface AccessLevelSelectorProps {
  accessLevel: CopilotAccessLevel
  isNearTop: boolean
  onAccessLevelChange?: (accessLevel: CopilotAccessLevel) => void
}

const getAccessLevelIcon = (accessLevel: CopilotAccessLevel) => {
  if (accessLevel === 'full') {
    return <ShieldAlert className='h-3 w-3 text-muted-foreground' />
  }

  return <ShieldCheck className='h-3 w-3 text-muted-foreground' />
}

const getAccessLevelText = (accessLevel: CopilotAccessLevel) => {
  if (accessLevel === 'full') {
    return 'Full'
  }

  return 'Limited'
}

export function AccessLevelSelector({
  accessLevel,
  isNearTop,
  onAccessLevelChange,
}: AccessLevelSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={!onAccessLevelChange}
          className='flex h-6 items-center gap-1.5 rounded-sm border bg-background px-2 py-1 font-medium text-xs hover:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0'
        >
          {getAccessLevelIcon(accessLevel)}
          <span>{getAccessLevelText(accessLevel)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'} className='p-0'>
        <TooltipProvider>
          <div className='w-[160px] p-1'>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  onSelect={() => onAccessLevelChange?.('limited')}
                  className={cn(
                    'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                    accessLevel === 'limited' && 'bg-muted/40'
                  )}
                >
                  <span className='flex items-center gap-1.5'>
                    <ShieldAlert className='h-3 w-3 text-muted-foreground' />
                    Limited
                  </span>
                  {accessLevel === 'limited' && <Check className='h-3 w-3 text-muted-foreground' />}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent
                side='right'
                sideOffset={6}
                align='center'
                className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
              >
                Reviews each tool before it runs.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  onSelect={() => onAccessLevelChange?.('full')}
                  className={cn(
                    'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                    accessLevel === 'full' && 'bg-muted/40'
                  )}
                >
                  <span className='flex items-center gap-1.5'>
                    <ShieldAlert className='h-3 w-3 text-muted-foreground' />
                    Full
                  </span>
                  {accessLevel === 'full' && <Check className='h-3 w-3 text-muted-foreground' />}
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent
                side='right'
                sideOffset={6}
                align='center'
                className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
              >
                Allows tools to run without extra approval.
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
