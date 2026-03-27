'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, ToolCase, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useSkills } from '@/hooks/queries/skills'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface StoredSkill {
  skillId: string
  name?: string
}

interface SkillInputProps {
  blockId: string
  subBlockId: string
  disabled?: boolean
}

export function SkillInput({ blockId, subBlockId, disabled = false }: SkillInputProps) {
  const workspaceId = useWorkspaceId()
  const [open, setOpen] = useState(false)
  const [storedValue, setStoredValue] = useSubBlockValue<StoredSkill[]>(blockId, subBlockId)
  const { data: workspaceSkills = [] } = useSkills(workspaceId)

  const selectedSkills = useMemo(
    () => (Array.isArray(storedValue) ? storedValue : []),
    [storedValue]
  )

  const selectedSkillIds = useMemo(
    () => new Set(selectedSkills.map((skill) => skill.skillId)),
    [selectedSkills]
  )

  const selectedLabel = useMemo(() => {
    if (selectedSkills.length === 0) {
      return 'Select skills'
    }

    const resolvedNames = selectedSkills
      .map((storedSkill) => {
        const foundSkill = workspaceSkills.find((skill) => skill.id === storedSkill.skillId)
        return foundSkill?.name ?? storedSkill.name ?? storedSkill.skillId
      })
      .filter((name): name is string => typeof name === 'string' && name.length > 0)

    if (resolvedNames.length === 0) {
      return 'Select skills'
    }

    if (resolvedNames.length === 1) {
      return resolvedNames[0]
    }

    return `${resolvedNames[0]} +${resolvedNames.length - 1}`
  }, [selectedSkills, workspaceSkills])

  const handleToggleSkill = (skillId: string, name: string) => {
    if (disabled) {
      return
    }

    if (selectedSkillIds.has(skillId)) {
      setStoredValue(selectedSkills.filter((skill) => skill.skillId !== skillId))
      return
    }

    setStoredValue([...selectedSkills, { skillId, name }])
  }

  const handleRemoveSkill = (skillId: string) => {
    if (disabled) {
      return
    }

    setStoredValue(selectedSkills.filter((skill) => skill.skillId !== skillId))
  }

  return (
    <div className='w-full space-y-2'>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='w-full justify-between'
            disabled={disabled || !workspaceId}
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              <ToolCase className='h-4 w-4 text-emerald-600' />
              <span
                className={cn('truncate', selectedSkills.length === 0 && 'text-muted-foreground')}
              >
                {selectedLabel}
              </span>
            </div>
            <ChevronDown className='h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[320px] p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search skills...' />
            <CommandList>
              <CommandEmpty>
                {workspaceId ? 'No skills found.' : 'Select a workspace first.'}
              </CommandEmpty>
              <CommandGroup heading='Skills'>
                {workspaceSkills.map((skill) => {
                  const isSelected = selectedSkillIds.has(skill.id)

                  return (
                    <CommandItem
                      key={skill.id}
                      value={`${skill.name} ${skill.description}`}
                      onSelect={() => handleToggleSkill(skill.id, skill.name)}
                    >
                      <div className='flex min-w-0 flex-1 items-start gap-2'>
                        <span className='mt-0.5 flex h-4 w-4 items-center justify-center rounded-xs bg-emerald-500/10 p-0.5'>
                          <ToolCase className='h-full w-full text-emerald-600' />
                        </span>
                        <div className='min-w-0 flex-1'>
                          <div className='truncate font-medium text-sm'>{skill.name}</div>
                          <div className='truncate text-muted-foreground text-xs'>
                            {skill.description}
                          </div>
                        </div>
                      </div>
                      <Check
                        className={cn(
                          'ml-2 h-4 w-4 shrink-0',
                          isSelected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedSkills.length > 0 ? (
        <div className='flex flex-wrap gap-1.5'>
          {selectedSkills.map((storedSkill) => {
            const resolvedName =
              workspaceSkills.find((skill) => skill.id === storedSkill.skillId)?.name ??
              storedSkill.name ??
              storedSkill.skillId

            return (
              <div
                key={storedSkill.skillId}
                className='inline-flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs'
              >
                <ToolCase className='h-3 w-3 text-emerald-600' />
                <span className='font-medium text-emerald-700 dark:text-emerald-300'>
                  {resolvedName}
                </span>
                {!disabled ? (
                  <button
                    type='button'
                    className='text-emerald-700/70 transition-colors hover:text-emerald-700 dark:text-emerald-300/70 dark:hover:text-emerald-300'
                    onClick={() => handleRemoveSkill(storedSkill.skillId)}
                    aria-label={`Remove ${resolvedName}`}
                  >
                    <X className='h-3 w-3' />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
