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
import { useCopilotMessages } from '@/i18n/workspace-widget-hooks'

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

export function AccessLevelSelector({
  accessLevel,
  isNearTop,
  onAccessLevelChange,
}: AccessLevelSelectorProps) {
  const accessLevelCopy = useCopilotMessages().accessLevel
  const buttonLabel = accessLevelCopy[accessLevel].label

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
          <span>{buttonLabel}</span>
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
                    {getAccessLevelIcon('limited')}
                    {accessLevelCopy.limited.label}
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
                {accessLevelCopy.limited.description}
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
                    {getAccessLevelIcon('full')}
                    {accessLevelCopy.full.label}
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
                {accessLevelCopy.full.description}
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
