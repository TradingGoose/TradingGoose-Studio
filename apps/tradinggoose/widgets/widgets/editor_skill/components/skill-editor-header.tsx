'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { exportSkillsAsJson } from '@/lib/skills/import-export'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { useSkillsStore } from '@/stores/skills/store'
import type { PairColor } from '@/widgets/pair-colors'
import { emitSkillEditorAction, useSkillEditorState } from '@/widgets/utils/skill-editor-actions'
import { emitSkillSelectionChange } from '@/widgets/utils/skill-selection'
import {
  buildPersistedPairContext,
  readEntitySelectionState,
  SKILL_EDITOR_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { SkillDropdown } from '@/widgets/widgets/components/skill-dropdown'

interface SkillEditorSelectorProps {
  workspaceId?: string
  panelId?: string
  skillId?: string | null
  pairColor?: PairColor
  widgetKey?: string
  params?: Record<string, unknown> | null
}

export function SkillEditorSelector({
  workspaceId,
  panelId,
  skillId,
  pairColor = 'gray',
  widgetKey,
  params,
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
      setPairContext(
        resolvedPairColor,
        buildPersistedPairContext({
          existing: pairContext,
          legacyIdKey: 'skillId',
          descriptor: null,
          legacyEntityId: nextSkillId,
        })
      )
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
  params?: Record<string, unknown> | null
}

const sanitizeFileNameSegment = (value: string) =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')

const downloadJsonFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = blobUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(blobUrl)
}

export function SkillEditorExportButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: SkillEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const [isDirty, setIsDirty] = useState(true)

  const resolvedSkillId = isLinkedToColorPair
    ? (pairContext?.skillId ?? skillId ?? null)
    : (skillId ?? null)
  const skill = useSkillsStore((state) =>
    workspaceId && resolvedSkillId ? state.getSkill(resolvedSkillId, workspaceId) : undefined
  )

  useSkillEditorState({
    panelId,
    widget: widgetKey ? ({ key: widgetKey } as { key: string }) : null,
    onStateChange: (detail) => {
      setIsDirty(detail.isDirty)
    },
  })

  useEffect(() => {
    setIsDirty(true)
  }, [resolvedSkillId, workspaceId])

  const fileName = useMemo(() => {
    if (!skill?.name) {
      return 'skill.json'
    }

    const normalized = sanitizeFileNameSegment(skill.name)
    return normalized.length > 0 ? `${normalized}.json` : 'skill.json'
  }, [skill?.name])

  const exportDisabled = !workspaceId || !resolvedSkillId || !skill || isDirty
  const tooltipText =
    exportDisabled && skill && isDirty ? 'Save skill before exporting' : 'Export skill'

  const handleExport = useCallback(() => {
    if (!skill) return

    const json = exportSkillsAsJson({
      exportedFrom: 'skillEditor',
      skills: [skill],
    })

    downloadJsonFile(fileName, json)
  }, [fileName, skill])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={handleExport}
            disabled={exportDisabled}
          >
            <Download className='h-4 w-4' />
            <span className='sr-only'>Export skill</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{tooltipText}</TooltipContent>
    </Tooltip>
  )
}

export function SkillEditorSaveButton({
  workspaceId,
  skillId,
  panelId,
  widgetKey,
  pairColor = 'gray',
  params,
}: SkillEditorActionButtonProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const selectionState = readEntitySelectionState({
    params,
    pairContext: isLinkedToColorPair ? pairContext : null,
    legacyIdKey: 'skillId',
  })
  const resolvedSkillId = selectionState.legacyEntityId ?? skillId ?? null
  const saveDisabled =
    !workspaceId &&
    !resolvedSkillId &&
    !selectionState.reviewSessionId &&
    !selectionState.reviewDraftSessionId
  const disabled =
    !workspaceId ||
    (!resolvedSkillId && !selectionState.reviewSessionId && !selectionState.reviewDraftSessionId)

  return (
    <EntityEditorHeaderButton
      tooltip='Save skill'
      label='Save skill'
      icon={Save}
      disabled={disabled || saveDisabled}
      variant='default'
      onClick={() => emitSkillEditorAction({ action: 'save', panelId, widgetKey })}
    />
  )
}
