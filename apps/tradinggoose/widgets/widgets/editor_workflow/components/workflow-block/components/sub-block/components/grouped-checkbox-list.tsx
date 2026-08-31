'use client'

import { useMemo, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatWorkflowTemplate } from '@/i18n/workflow-inspector-core'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowI18n } from '@/widgets/widgets/editor_workflow/copy'

interface GroupedCheckboxListProps {
  blockId: string
  subBlockId: string
  options: { label: string; id: string; group?: string }[]
  disabled?: boolean
}

export function GroupedCheckboxList({
  blockId,
  subBlockId,
  options,
  disabled = false,
}: GroupedCheckboxListProps) {
  const { translateWorkflowLabel } = useWorkflowI18n()
  const [open, setOpen] = useState(false)
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const selectedValues = (storeValue as string[]) || []

  const groupedOptions = useMemo(() => {
    const groups: Record<string, { label: string; id: string }[]> = {}

    options.forEach((option) => {
      const groupName = option.group || translateWorkflowLabel('other')
      if (!groups[groupName]) {
        groups[groupName] = []
      }
      groups[groupName].push({ label: option.label, id: option.id })
    })

    return groups
  }, [options, translateWorkflowLabel])

  const handleToggle = (optionId: string) => {
    if (disabled) return

    const currentValues = (selectedValues || []) as string[]
    const newValues = currentValues.includes(optionId)
      ? currentValues.filter((id) => id !== optionId)
      : [...currentValues, optionId]

    setStoreValue(newValues)
  }

  const handleSelectAll = () => {
    if (disabled) return
    const allIds = options.map((opt) => opt.id)
    setStoreValue(allIds)
  }

  const handleClear = () => {
    if (disabled) return
    setStoreValue([])
  }

  const allSelected = selectedValues.length === options.length
  const noneSelected = selectedValues.length === 0

  const SelectedCountDisplay = () => {
    if (noneSelected) {
      return (
        <span className='text-muted-foreground text-sm'>
          {translateWorkflowLabel('noneSelected')}
        </span>
      )
    }
    if (allSelected) {
      return <span className='text-sm'>{translateWorkflowLabel('allSelected')}</span>
    }
    return (
      <span className='text-sm'>
        {formatWorkflowTemplate(translateWorkflowLabel('selectedCount'), {
          count: selectedValues.length,
        })}
      </span>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        disabled={disabled}
        render={
          <Button
            variant='outline'
            className='h-10 w-full justify-between border-input bg-background px-3 font-normal text-sm hover:bg-card hover:text-accent-foreground'
            disabled={disabled}
          >
            <span className='flex items-center gap-1 text-muted-foreground'>
              <Settings2 className='h-4 w-4' />
              <span>{translateWorkflowLabel('configurePiiTypes')}</span>
            </span>
            <SelectedCountDisplay />
          </Button>
        }
      />
      <DialogContent
        className='flex max-h-[80vh] max-w-2xl flex-col'
        onWheel={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{translateWorkflowLabel('selectPiiTypesToDetect')}</DialogTitle>
          <p className='text-muted-foreground text-sm'>
            {translateWorkflowLabel('choosePiiTypesToDetect')}
          </p>
        </DialogHeader>

        {/* Header with Select All and Clear */}
        <div className='flex items-center justify-between border-b pb-3'>
          <div className='flex items-center gap-1'>
            <Checkbox
              id='select-all'
              checked={allSelected}
              onCheckedChange={(checked) => {
                if (checked) {
                  handleSelectAll()
                } else {
                  handleClear()
                }
              }}
              disabled={disabled}
            />
            <label
              htmlFor='select-all'
              className='cursor-pointer font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
            >
              {translateWorkflowLabel('selectAllEntities')}
            </label>
          </div>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleClear}
            disabled={disabled || noneSelected}
            className='w-[85px]'
          >
            <span className='flex items-center gap-1'>
              {translateWorkflowLabel('clear')}
              {!noneSelected && <span>({selectedValues.length})</span>}
            </span>
          </Button>
        </div>

        {/* Scrollable grouped checkboxes */}
        <div
          className='flex-1 overflow-y-auto pr-4'
          onWheel={(e) => e.stopPropagation()}
          style={{ maxHeight: '60vh' }}
        >
          <div className='space-y-6'>
            {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
              <div key={groupName}>
                <h3 className='mb-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider'>
                  {groupName}
                </h3>
                <div className='space-y-3'>
                  {groupOptions.map((option) => (
                    <div key={option.id} className='flex items-center gap-1'>
                      <Checkbox
                        id={`${subBlockId}-${option.id}`}
                        checked={selectedValues.includes(option.id)}
                        onCheckedChange={() => handleToggle(option.id)}
                        disabled={disabled}
                      />
                      <label
                        htmlFor={`${subBlockId}-${option.id}`}
                        className='cursor-pointer text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
