'use client'

import { useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ENTITY_KIND_SKILL, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import {
  useEntitySession,
} from '@/lib/copilot/review-sessions/entity-session-host'
import type { WidgetComponentProps } from '@/widgets/types'
import { useSkillEditorActions } from '@/widgets/utils/skill-editor-actions'
import { useSkillSelectionPersistence } from '@/widgets/utils/skill-selection'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { SkillEditor } from '@/widgets/widgets/editor_skill/skill-editor'
import {
  buildPersistedPairContext,
  buildPersistedReviewParams,
  readEntitySelectionState,
  SKILL_EDITOR_WIDGET_KEY,
} from '@/widgets/widgets/_shared/skill/utils'
import {
  EntityEditorShell,
  type EntityEditorShellConfig,
} from '@/widgets/widgets/components/entity-editor-shell'
import { useGuardedUndoRedo } from '@/widgets/widgets/entity_review/use-guarded-undo-redo'

const SKILL_SHELL_CONFIG: EntityEditorShellConfig = {
  entityKind: ENTITY_KIND_SKILL,
  fallbackWidgetKey: SKILL_EDITOR_WIDGET_KEY,
  legacyIdKey: 'skillId',
  buildWidgetParams: buildPersistedReviewParams,
  buildPairContext: buildPersistedPairContext,
  readEntitySelectionState,
  noWorkspaceMessage: 'Select a workspace to edit skills.',
  noSelectionMessage: 'Select a skill to edit.',
}

type EditorSkillWidgetBodyProps = WidgetComponentProps

export function EditorSkillWidgetBody(props: EditorSkillWidgetBodyProps) {
  return (
    <EntityEditorShell
      {...props}
      config={SKILL_SHELL_CONFIG}
      useSelectionPersistence={({
        resolvedPairColor,
        isLinkedToColorPair,
        pairContext,
        setPairContext,
        onWidgetParamsChange,
        panelId,
        params,
      }) => {
        useSkillSelectionPersistence({
          onWidgetParamsChange,
          panelId,
          params,
          pairColor: resolvedPairColor,
          scopeKey: SKILL_EDITOR_WIDGET_KEY,
          onSkillSelect: (skillId) => {
            if (!isLinkedToColorPair) {
              return
            }

            if (pairContext?.skillId === skillId) {
              return
            }

            setPairContext(
              resolvedPairColor,
              buildPersistedPairContext({
                existing: pairContext,
                legacyIdKey: 'skillId',
                descriptor: null,
                legacyEntityId: skillId,
              })
            )
          },
        })
      }}
    >
      {({ workspaceId, descriptor, persistDescriptor, panelId, widget }) => (
        <SkillEditorSession
          workspaceId={workspaceId}
          panelId={panelId}
          widget={widget}
          descriptor={descriptor}
          onReviewTargetChange={persistDescriptor}
        />
      )}
    </EntityEditorShell>
  )
}

function SkillEditorSession({
  workspaceId,
  panelId,
  widget,
  descriptor,
  onReviewTargetChange,
}: {
  workspaceId: string
  panelId?: string
  widget?: WidgetComponentProps['widget']
  descriptor: ReviewTargetDescriptor
  onReviewTargetChange: (descriptor: ReviewTargetDescriptor | null) => void
}) {
  const saveRef = useRef<() => void>(() => {})
  const { doc, isLoading, error, undo, redo, runtime, canUndo, canRedo } = useEntitySession()
  const { handleUndo, handleRedo } = useGuardedUndoRedo({ runtime, undo, redo, canUndo, canRedo })

  useSkillEditorActions({
    panelId,
    widget,
    save: () => saveRef.current(),
    undo: handleUndo,
    redo: handleRedo,
  })

  if (isLoading || !doc) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (error) {
    return <WidgetStateMessage message={error} />
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden'>
      <SkillEditor
        workspaceId={workspaceId}
        descriptor={descriptor}
        saveRef={saveRef}
        yjsDoc={doc}
        onReviewTargetChange={onReviewTargetChange}
      />
    </div>
  )
}
