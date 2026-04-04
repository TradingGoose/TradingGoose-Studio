'use client'

import { useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ENTITY_KIND_INDICATOR, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import {
  useEntitySession,
} from '@/lib/copilot/review-sessions/entity-session-host'
import type { WidgetComponentProps } from '@/widgets/types'
import { useIndicatorEditorActions } from '@/widgets/utils/indicator-editor-actions'
import { useIndicatorSelectionPersistence } from '@/widgets/utils/indicator-selection'
import { IndicatorCodePanel } from '@/widgets/widgets/editor_indicator/components/pine-indicator-code-panel'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import {
  buildPersistedPairContext,
  buildPersistedReviewParams,
  readEntitySelectionState,
} from '@/widgets/widgets/editor_indicator/utils'
import {
  EntityEditorShell,
  type EntityEditorShellConfig,
} from '@/widgets/widgets/components/entity-editor-shell'
import { useGuardedUndoRedo } from '@/widgets/widgets/entity_review/use-guarded-undo-redo'

const INDICATOR_SHELL_CONFIG: EntityEditorShellConfig = {
  entityKind: ENTITY_KIND_INDICATOR,
  fallbackWidgetKey: 'editor_indicator',
  legacyIdKey: 'indicatorId',
  buildWidgetParams: buildPersistedReviewParams,
  buildPairContext: buildPersistedPairContext,
  readEntitySelectionState,
  noWorkspaceMessage: 'Select a workspace to edit indicators.',
  noSelectionMessage: 'Select an indicator to edit.',
}

type EditorIndicatorWidgetBodyProps = WidgetComponentProps

export function EditorIndicatorWidgetBody(props: EditorIndicatorWidgetBodyProps) {
  return (
    <EntityEditorShell
      {...props}
      config={INDICATOR_SHELL_CONFIG}
      useSelectionPersistence={({
        resolvedPairColor,
        isLinkedToColorPair,
        pairContext,
        setPairContext,
        onWidgetParamsChange,
        panelId,
        params,
      }) => {
        useIndicatorSelectionPersistence({
          onWidgetParamsChange,
          panelId,
          params,
          pairColor: resolvedPairColor,
          onIndicatorSelect: (indicatorId) => {
            if (!isLinkedToColorPair) {
              return
            }

            if (pairContext?.indicatorId === indicatorId) {
              return
            }

            setPairContext(
              resolvedPairColor,
              buildPersistedPairContext({
                existing: pairContext,
                legacyIdKey: 'indicatorId',
                descriptor: null,
                legacyEntityId: indicatorId,
              })
            )
          },
        })
      }}
    >
      {({ workspaceId, descriptor, persistDescriptor, panelId, widget }) => (
        <IndicatorEditorSession
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

function IndicatorEditorSession({
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
  const verifyRef = useRef<() => void>(() => {})
  const { doc, isLoading, error, undo, redo, runtime, canUndo, canRedo } = useEntitySession()
  const { handleUndo, handleRedo } = useGuardedUndoRedo({ runtime, undo, redo, canUndo, canRedo })

  useIndicatorEditorActions({
    panelId,
    widget,
    save: () => saveRef.current(),
    verify: () => verifyRef.current(),
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
      <IndicatorCodePanel
        workspaceId={workspaceId}
        descriptor={descriptor}
        saveRef={saveRef}
        verifyRef={verifyRef}
        yjsDoc={doc}
        onReviewTargetChange={onReviewTargetChange}
      />
    </div>
  )
}
