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
  disabled?: boolean
  label: ReactNode
  searchValue?: string
  value: string
}

type SearchableDropdownProps<TOption extends SearchableDropdownOption> = {
  closeOnSelect?: boolean
  disabled?: boolean
  emptyText: ReactNode
  footer?: ReactNode
  isOptionSelected?: (option: TOption) => boolean
  onOpenChange?: (open: boolean) => void
  onValueChange: (value: string) => void
  open?: boolean
  options: TOption[]
  placeholder: ReactNode
  renderOption?: (option: TOption, selected: boolean) => ReactNode
  renderTriggerValue?: (selected: TOption | null) => ReactNode
  searchPlaceholder: string
  triggerClassName?: string
  triggerLabel?: string
  value?: string | null
}

export function SearchableDropdown<TOption extends SearchableDropdownOption>({
  closeOnSelect = true,
  disabled,
  emptyText,
  footer,
  isOptionSelected,
  onOpenChange,
  onValueChange,
  open,
  options,
  placeholder,
  renderOption,
  renderTriggerValue,
  searchPlaceholder,
  triggerClassName,
  triggerLabel,
  value,
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
    <DropdownMenu open={resolvedOpen} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          className={triggerClassName}
          role='combobox'
          aria-expanded={resolvedOpen}
          aria-label={triggerLabel}
        >
          {renderTriggerValue ? (
            renderTriggerValue(selectedOption)
          ) : (
            <span
              className={cn(
                'truncate',
                selectedOption ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {selectedOption?.label ?? placeholder}
            </span>
          )}
          <ChevronDown className='ml-0.5 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const selected = option.value === selectedOption?.value

                return (
                  <CommandItem
                    key={option.value}
                    value={
                      option.searchValue ??
                      (typeof option.label === 'string'
                        ? `${option.label} ${option.value}`
                        : option.value)
                    }
                    disabled={option.disabled}
                    onSelect={() => {
                      if (option.disabled) return
                      onValueChange(option.value)
                      if (closeOnSelect) {
                        handleOpenChange(false)
                      }
                    }}
                  >
                    <div className='flex min-w-0 flex-1 items-center gap-2'>
                      {renderOption ? (
                        renderOption(option, selected)
                      ) : (
                        <span className='truncate'>{option.label}</span>
                      )}
                    </div>
                    {isOptionSelected ? (
                      isOptionSelected(option) ? (
                        <Check className='ml-2 h-4 w-4 text-primary' />
                      ) : null
                    ) : selected ? (
                      <Check className='ml-2 h-4 w-4 text-primary' />
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {footer}
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
