'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type SearchableDropdownOption = {
  value: string
  label: string
  searchValue?: string
}

type SearchableDropdownProps<TOption extends SearchableDropdownOption> = {
  value?: string | null
  options: TOption[]
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  onValueChange: (value: string) => void
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  renderTriggerValue?: (selected: TOption | null) => ReactNode
  renderOption?: (option: TOption, selected: boolean) => ReactNode
}

export function SearchableDropdown<TOption extends SearchableDropdownOption>({
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  onValueChange,
  disabled,
  triggerClassName,
  contentClassName,
  open,
  onOpenChange,
  renderTriggerValue,
  renderOption,
}: SearchableDropdownProps<TOption>) {
  const [internalOpen, setInternalOpen] = useState(false)
  const resolvedOpen = open ?? internalOpen

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange?.(nextOpen)
    if (open === undefined) {
      setInternalOpen(nextOpen)
    }
  }

  return (
    <DropdownMenu open={resolvedOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          className={cn('p-2 h-9 w-full justify-between', triggerClassName)}
          disabled={disabled}
        >
          {renderTriggerValue ? (
            renderTriggerValue(selectedOption)
          ) : (
            <span
              className={cn(
                'truncate text-sm',
                selectedOption ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {selectedOption?.label || placeholder}
            </span>
          )}
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className={cn(
          'w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)] max-w-[var(--radix-dropdown-menu-trigger-width)] p-0',
          contentClassName
        )}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className='max-h-[240px]'>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = option.value === selectedOption?.value

                return (
                  <CommandItem
                    key={option.value}
                    value={option.searchValue || `${option.label} ${option.value}`}
                    onSelect={() => {
                      onValueChange(option.value)
                      handleOpenChange(false)
                    }}
                  >
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                      {renderOption ? (
                        renderOption(option, isSelected)
                      ) : (
                        <span className='truncate'>{option.label}</span>
                      )}
                    </div>
                    {isSelected ? <Check className='ml-2 h-4 w-4 text-primary' /> : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
