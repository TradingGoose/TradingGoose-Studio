'use client'

import { useEffect, useRef, useState } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useSkills } from '@/hooks/queries/skills'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { emitSkillEditorState, useSkillEditorActions } from '@/widgets/utils/skill-editor-actions'
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
  const workspaceId = context?.workspaceId ?? null
  const { data: skills = [], isLoading, error } = useSkills(workspaceId ?? '')
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const saveRef = useRef<() => void>(() => {})
  const [isDirty, setIsDirty] = useState(false)

  const paramsSkillId = getSkillIdFromParams(params)
  const requestedSkillId = isLinkedToColorPair
    ? (pairContext?.skillId ?? paramsSkillId)
    : paramsSkillId
  const normalizedRequestedSkillId = requestedSkillId?.trim() ?? ''
  const hasRequestedSkill =
    normalizedRequestedSkillId.length > 0 &&
    skills.some((skill) => skill.id === normalizedRequestedSkillId)
  const skillId = hasRequestedSkill ? normalizedRequestedSkillId : (skills[0]?.id ?? null)
  const skill = skillId ? (skills.find((candidate) => candidate.id === skillId) ?? null) : null

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
    onSave: () => saveRef.current(),
  })

  useEffect(() => {
    emitSkillEditorState({
      isDirty,
      panelId,
      widgetKey: widget?.key,
    })

    return () => {
      emitSkillEditorState({
        isDirty: false,
        panelId,
        widgetKey: widget?.key,
      })
    }
  }, [isDirty, panelId, widget?.key])

  useEffect(() => {
    if (!skillId || !skill) {
      setIsDirty(false)
    }
  }, [skill, skillId])

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to edit skills.' />
  }

  if (error && skills.length === 0) {
    return (
      <WidgetStateMessage
        message={error instanceof Error ? error.message : 'Failed to load skills.'}
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
    return <WidgetStateMessage message='Select a skill to edit.' />
  }

  if (!skill) {
    return <WidgetStateMessage message='Skill not found.' />
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <SkillEditor
        workspaceId={workspaceId}
        saveRef={saveRef}
        onDirtyChange={setIsDirty}
        initialValues={{
          id: skill.id,
          name: skill.name,
          description: skill.description,
          content: skill.content,
        }}
      />
    </div>
  )
}
