'use client'

import { BotMessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Switch } from '@/components/ui/switch'

export function CopilotSidebarToggle({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state } = useSidebar()
  const tCopilot = useTranslations('workspace.nav.copilot')
  const actionLabel = open ? tCopilot('hide') : tCopilot('show')

  if (state === 'collapsed') {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            type='button'
            isActive={open}
            className='data-[active=true]:bg-primary data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary-hover data-[active=true]:hover:text-primary-foreground'
            tooltip={actionLabel}
            aria-label={actionLabel}
            aria-pressed={open}
            onClick={() => onOpenChange(!open)}
          >
            <BotMessageSquare />
            <span>{tCopilot('label')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <div className='flex items-center justify-between gap-2 px-2 py-1'>
      <span className='flex min-w-0 items-center gap-2 font-medium text-sm'>
        <BotMessageSquare className='h-4 w-4 shrink-0' aria-hidden='true' />
        <span className='truncate'>{tCopilot('label')}</span>
      </span>
      <Switch checked={open} onCheckedChange={onOpenChange} aria-label={actionLabel} />
    </div>
  )
}
