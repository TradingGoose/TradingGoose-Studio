import { useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { type LocaleCode } from '@/i18n/utils'
import { dropdownContentClass, filterButtonClass } from './shared'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TriggerType } from '@/stores/logs/filters/types'

export default function Trigger() {
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.logs.dashboard.filters
  const { triggers, toggleTrigger, setTriggers } = useFilterStore()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const triggerOptions: { value: TriggerType; label: string; color?: string }[] = [
    { value: 'manual', label: copy.manual, color: 'bg-gray-500' },
    { value: 'api', label: copy.api, color: 'bg-blue-500' },
    { value: 'webhook', label: copy.webhook, color: 'bg-orange-500' },
    { value: 'schedule', label: copy.schedule, color: 'bg-green-500' },
    { value: 'chat', label: copy.chat, color: 'bg-amber-500' },
  ]

  // Get display text for the dropdown button
  const getSelectedTriggersText = () => {
    if (triggers.length === 0) return copy.allTriggers
    if (triggers.length === 1) {
      const selected = triggerOptions.find((t) => t.value === triggers[0])
      return selected ? selected.label : copy.allTriggers
    }
    return formatTemplate(copy.selectedTriggers, {
      count: triggers.length,
      plural: triggers.length !== 1 ? 's' : '',
    })
  }

  // Check if a trigger is selected
  const isTriggerSelected = (trigger: TriggerType) => {
    return triggers.includes(trigger)
  }

  // Clear all selections
  const clearSelections = () => {
    setTriggers([])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant='outline' size='sm' className={filterButtonClass}>
          {getSelectedTriggersText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <div className='py-1'>
          <DropdownMenuItem
            onSelect={() => clearSelections()}
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <span>{copy.allTriggers}</span>
            {triggers.length === 0 && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {triggerOptions.map((triggerItem) => (
            <DropdownMenuItem
              key={triggerItem.value}
              onSelect={() => toggleTrigger(triggerItem.value)}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <div className='flex items-center'>
                {triggerItem.color && (
                  <div className={`mr-2 h-2 w-2 rounded-full ${triggerItem.color}`} />
                )}
                {triggerItem.label}
              </div>
              {isTriggerSelected(triggerItem.value) && (
                <Check className='h-4 w-4 text-muted-foreground' />
              )}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
