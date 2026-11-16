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
import { useCopilotStore } from '@/stores/copilot/store'
import { isCopilotBusy } from '@/stores/copilot/store-state'

const getAccessLevelIcon = (accessLevel: CopilotAccessLevel) => {
  if (accessLevel === 'full') {
    return <ShieldAlert className='h-3 w-3 text-muted-foreground' />
  }

  return <ShieldCheck className='h-3 w-3 text-muted-foreground' />
}

export function AccessLevelSelector({ isNearTop }: { isNearTop: boolean }) {
  const accessLevel = useCopilotStore((state) => state.accessLevel)
  const setAccessLevel = useCopilotStore((state) => state.setAccessLevel)
  const busy = useCopilotStore(isCopilotBusy)
  const accessLevelCopy = useCopilotMessages().accessLevel
  const buttonLabel = accessLevelCopy[accessLevel].label

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        render={
          <Button
            variant='outline'
            size='sm'
            className='flex h-6 items-center gap-1.5 rounded-sm border bg-background px-2 py-1 font-medium text-xs hover:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        }
      >
        {getAccessLevelIcon(accessLevel)}
        <span>{buttonLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' side={isNearTop ? 'bottom' : 'top'} className='p-0'>
        <TooltipProvider>
          <div className='w-[160px] p-1'>
            {(['limited', 'full'] as const).map((level) => (
              <Tooltip key={level}>
                <TooltipTrigger
                  render={
                    <DropdownMenuItem
                      disabled={busy}
                      onClick={() => setAccessLevel(level)}
                      className={cn(
                        'flex items-center justify-between rounded-sm px-2 py-1.5 text-xs leading-4',
                        accessLevel === level && 'bg-muted/40'
                      )}
                    >
                      <span className='flex items-center gap-1.5'>
                        {getAccessLevelIcon(level)}
                        {accessLevelCopy[level].label}
                      </span>
                      {accessLevel === level && <Check className='h-3 w-3 text-muted-foreground' />}
                    </DropdownMenuItem>
                  }
                />
                <TooltipContent
                  side='right'
                  sideOffset={6}
                  align='center'
                  className='max-w-[220px] border bg-popover p-2 text-[11px] text-popover-foreground leading-snug shadow-md'
                >
                  {accessLevelCopy[level].description}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
