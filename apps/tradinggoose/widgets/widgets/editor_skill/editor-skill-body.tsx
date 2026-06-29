'use client'

import { useEffect, useRef } from 'react'
import { useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useSkills } from '@/hooks/queries/skills'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useSkillEditorActions } from '@/widgets/utils/skill-editor-actions'
import { useSkillSelectionPersistence } from '@/widgets/utils/skill-selection'
import { getSkillIdFromParams } from '@/widgets/widgets/_shared/skill/utils'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { SkillEditor } from '@/widgets/widgets/editor_skill/skill-editor'

type EditorSkillWidgetBodyProps = WidgetComponentProps

export function EditorSkillWidgetBody({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: EditorSkillWidgetBodyProps) {
  const copy = useMessages().workspace.widgets.skillEditor.body
  const workspaceId = context?.workspaceId ?? null
  const { data: skills = [], isLoading, error } = useSkills(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const exportRef = useRef<() => void>(() => {})
  const saveRef = useRef<() => void>(() => {})

  const paramsSkillId = getSkillIdFromParams(params)
  const requestedSkillId = isLinkedToColorPair ? (pairContext?.skillId ?? null) : paramsSkillId
  const normalizedRequestedSkillId = requestedSkillId?.trim() ?? ''
  const hasRequestedSkill =
    normalizedRequestedSkillId.length > 0 &&
    skills.some((skill) => skill.id === normalizedRequestedSkillId)
  const skillId = hasRequestedSkill
    ? normalizedRequestedSkillId
    : isLinkedToColorPair
      ? null
      : (skills[0]?.id ?? null)
  const skill = skillId ? (skills.find((candidate) => candidate.id === skillId) ?? null) : null
  const skillSession = useSavedEntityYjsSession('skill', skillId, workspaceId)

  useEffect(() => {
    if (!skillId) {
      return
    }

    if (isLinkedToColorPair) {
      if (pairContext?.skillId === skillId) {
        return
      }

      setPairContext(resolvedPairColor, { skillId })
      return
    }

    if (!onWidgetParamsChange || paramsSkillId === skillId) {
      return
    }

    onWidgetParamsChange({
      ...(params ?? {}),
      skillId,
    })
  }, [
    isLinkedToColorPair,
    onWidgetParamsChange,
    pairContext?.skillId,
    params,
    paramsSkillId,
    resolvedPairColor,
    setPairContext,
    skillId,
  ])

  useSkillSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    onSkillSelect: (nextSkillId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.skillId === nextSkillId) return
      setPairContext(resolvedPairColor, { skillId: nextSkillId })
    },
  })

  useSkillEditorActions({
    panelId,
    widget,
    onExport: () => exportRef.current(),
    onSave: () => saveRef.current(),
  })

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.selectWorkspace} />
  }

  if (error && skills.length === 0) {
    return (
      <WidgetStateMessage
        message={error instanceof Error ? error.message : copy.failedToLoadSkills}
      />
    )
  }

  if (isLoading && skills.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!skillId) {
    return (
      <WidgetStateMessage
        message={
          isLinkedToColorPair
            ? normalizedRequestedSkillId.length > 0
              ? copy.skillNotFound
              : copy.noSharedSkillSelected
            : copy.selectSkillToEdit
        }
      />
    )
  }

  if (!skill) {
    return <WidgetStateMessage message={copy.skillNotFound} />
  }

  if (skillSession.error) {
    return <WidgetStateMessage message={skillSession.error} />
  }

  if (skillSession.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <SkillEditor
        doc={skillSession.doc}
        save={skillSession.save}
        skillId={skillId}
        exportRef={exportRef}
        saveRef={saveRef}
      />
    </div>
  )
}
