import { useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TriggerType } from '@/stores/logs/filters/types'
import { dropdownContentClass, filterButtonClass, logTriggerOptions } from './shared'

export default function Trigger() {
  const t = useTranslations('workspace.logs.dashboard.filters')
  const { triggers, toggleTrigger, setTriggers } = useFilterStore()
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Get display text for the dropdown button
  const getSelectedTriggersText = () => {
    if (triggers.length === 0) return t('allTriggers')
    if (triggers.length === 1) {
      const selected = logTriggerOptions.find((option) => option.value === triggers[0])
      return selected ? t(selected.labelKey) : t('allTriggers')
    }
    return t('selectedTriggers', {
      count: triggers.length,
      plural: triggers.length === 1 ? '' : 's',
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
      <DropdownMenuTrigger
        render={
          <Button ref={triggerRef} variant='outline' size='sm' className={filterButtonClass} />
        }
      >
        {getSelectedTriggersText()}
        <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        collisionAvoidance={{ side: 'none', align: 'none', fallbackAxisSide: 'none' }}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <div className='py-1'>
          <DropdownMenuItem
            onClick={() => clearSelections()}
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <span>{t('allTriggers')}</span>
            {triggers.length === 0 && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {logTriggerOptions.map((triggerItem) => (
            <DropdownMenuItem
              key={triggerItem.value}
              onClick={() => toggleTrigger(triggerItem.value)}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <div className='flex items-center'>
                <div className={`mr-2 h-2 w-2 rounded-full ${triggerItem.colorClass}`} />
                {t(triggerItem.labelKey)}
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
