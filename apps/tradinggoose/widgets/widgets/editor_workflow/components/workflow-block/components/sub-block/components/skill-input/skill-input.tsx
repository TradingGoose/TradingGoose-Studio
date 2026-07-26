'use client'

import { useMemo, useState } from 'react'
import { ToolCase, XIcon } from 'lucide-react'
import { useLocale } from 'next-intl'
import { cn } from '@/lib/utils'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { Dropdown } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const SKILL_COLOR = '#10b981' // emerald-500

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
  const locale = useLocale() as LocaleCode
  const workspaceId = useWorkspaceId()
  const [storedValue, setStoredValue] = useSubBlockValue<StoredSkill[]>(blockId, subBlockId)
  const { members: skillMembers } = useEntityList('skill', workspaceId)
  const [selectorValue, setSelectorValue] = useState('')

  const selectedSkills = useMemo(
    () => (Array.isArray(storedValue) ? storedValue : []),
    [storedValue]
  )

  const selectedSkillIds = useMemo(
    () => new Set(selectedSkills.map((skill) => skill.skillId)),
    [selectedSkills]
  )

  const dropdownOptions = useMemo(() => {
    return skillMembers
      .filter((skill) => !selectedSkillIds.has(skill.entityId))
      .map((skill) => ({
        label: skill.entityName,
        id: skill.entityId,
        icon: ToolCase,
        group: translateWorkflowLabel(locale, 'skills'),
      }))
  }, [locale, selectedSkillIds, skillMembers])

  const handleSkillSelection = (skillId: string) => {
    if (disabled || !skillId) return

    const skill = skillMembers.find((s) => s.entityId === skillId)
    if (!skill || selectedSkillIds.has(skillId)) return

    setStoredValue([...selectedSkills, { skillId, name: skill.entityName }])
    setSelectorValue('')
  }

  const handleRemoveSkill = (skillId: string) => {
    if (disabled) return
    setStoredValue(selectedSkills.filter((skill) => skill.skillId !== skillId))
  }

  return (
    <div className='w-full'>
      {selectedSkills.length === 0 ? (
        <Dropdown
          blockId={blockId}
          subBlockId={`${subBlockId}-skill-selector`}
          options={dropdownOptions}
          placeholder={translateWorkflowLabel(locale, 'addSkill')}
          useStore={false}
          valueOverride={selectorValue}
          onChange={handleSkillSelection}
          disabled={disabled || !workspaceId}
          className='w-full'
          enableSearch
          searchPlaceholder={translateWorkflowLabel(locale, 'searchSkills')}
        />
      ) : (
        <div className='flex min-h-[2.5rem] w-full flex-wrap gap-2 rounded-md border border-input bg-transparent p-2 text-sm ring-offset-background'>
          {selectedSkills.map((storedSkill) => {
            const resolvedName =
              skillMembers.find((skill) => skill.entityId === storedSkill.skillId)?.entityName ??
              storedSkill.name ??
              storedSkill.skillId

            return (
              <div
                key={storedSkill.skillId}
                className='flex w-full flex-col overflow-visible rounded-md border bg-card'
              >
                <div className={cn('flex items-center justify-between rounded-md bg-accent p-2')}>
                  <div className='flex min-w-0 flex-shrink-1 items-center gap-2 overflow-hidden'>
                    <div
                      className='relative flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
                      style={{
                        backgroundColor: `${SKILL_COLOR}20`,
                        color: SKILL_COLOR,
                      }}
                    >
                      <ToolCase className='h-3 w-3' style={{ color: SKILL_COLOR }} />
                    </div>
                    <span className='truncate font-medium text-sm'>{resolvedName}</span>
                  </div>
                  {!disabled ? (
                    <button
                      type='button'
                      className='ml-2 flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground'
                      onClick={() => handleRemoveSkill(storedSkill.skillId)}
                      aria-label={formatTemplate(translateWorkflowLabel(locale, 'removeSkill'), {
                        name: resolvedName,
                      })}
                    >
                      <XIcon className='h-3.5 w-3.5' />
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}

          <Dropdown
            blockId={blockId}
            subBlockId={`${subBlockId}-skill-selector-inline`}
            options={dropdownOptions}
            placeholder={translateWorkflowLabel(locale, 'addSkill')}
            useStore={false}
            valueOverride={selectorValue}
            onChange={handleSkillSelection}
            disabled={disabled || !workspaceId}
            className='w-full'
            enableSearch
            searchPlaceholder={translateWorkflowLabel(locale, 'searchSkills')}
          />
        </div>
      )}
    </div>
  )
}
