import { useRef } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { dropdownContentClass, filterButtonClass } from '@/app/workspace/[workspaceId]/logs/components/filters/components/shared'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TriggerType } from '@/stores/logs/filters/types'

export default function Trigger() {
  const { triggers, toggleTrigger, setTriggers } = useFilterStore()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const triggerOptions: { value: TriggerType; label: string; color?: string }[] = [
    { value: 'manual', label: 'Manual', color: 'bg-gray-500' },
    { value: 'api', label: 'API', color: 'bg-blue-500' },
    { value: 'webhook', label: 'Webhook', color: 'bg-orange-500' },
    { value: 'schedule', label: 'Schedule', color: 'bg-green-500' },
    { value: 'chat', label: 'Chat', color: 'bg-amber-500' },
  ]

  // Get display text for the dropdown button
  const getSelectedTriggersText = () => {
    if (triggers.length === 0) return 'All triggers'
    if (triggers.length === 1) {
      const selected = triggerOptions.find((t) => t.value === triggers[0])
      return selected ? selected.label : 'All triggers'
    }
    return `${triggers.length} triggers selected`
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
            <span>All triggers</span>
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
