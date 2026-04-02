'use client'

import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitSkillEditorAction } from '@/widgets/utils/skill-editor-actions'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import { SkillDropdown } from '@/widgets/widgets/components/skill-dropdown'
import { SKILL_EDITOR_WIDGET_KEY } from '@/widgets/widgets/_shared/skill/utils'

interface SkillEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  skillId?: string | null
  pairColor?: PairColor
  widgetKey?: string
}

export function SkillEditorSelector({
  workspaceId,
  panelId,
  skillId,
  pairColor = 'gray',
  widgetKey,
}: SkillEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const resolvedSkillId = isLinkedToColorPair
    ? (pairContext?.skillId ?? skillId ?? null)
    : (skillId ?? null)

  const handleSkillChange = (nextSkillId: string | null) => {
    if (isLinkedToColorPair) {
      if (pairContext?.skillId === nextSkillId) return
      setPairContext(resolvedPairColor, { skillId: nextSkillId })
      return
    }

    emitSkillSelectionChange({
      skillId: nextSkillId,
      panelId,
      widgetKey: widgetKey ?? SKILL_EDITOR_WIDGET_KEY,
    })
  }

  return (
    <SkillDropdown
      workspaceId={workspaceId}
      value={resolvedSkillId}
      onChange={handleSkillChange}
      placeholder='Select skill'
      triggerClassName='min-w-[240px]'
    />
  )
}

interface SkillEditorActionButtonProps {
  workspaceId?: string
  skillId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}

export function SkillEditorSaveButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: SkillEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedSkillId = isLinkedToColorPair
    ? (pairContext?.skillId ?? skillId ?? null)
    : (skillId ?? null)
  const saveDisabled = !workspaceId || !resolvedSkillId

  const handleSave = () => {
    emitSkillEditorAction({
      action: 'save',
      panelId,
      widgetKey,
    })
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='default'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleSave}
            disabled={saveDisabled}
          >
            <Save className='h-4 w-4' />
            <span className='sr-only'>Save skill</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Save skill</TooltipContent>
    </Tooltip>
  )
}
