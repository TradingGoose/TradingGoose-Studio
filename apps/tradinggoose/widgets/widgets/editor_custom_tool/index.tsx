'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Save, SquareTerminal } from 'lucide-react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { ENTITY_KIND_CUSTOM_TOOL, type ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import {
  useEntitySession,
} from '@/lib/copilot/review-sessions/entity-session-host'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import {
  CUSTOM_TOOL_EDITOR_ACTION_EVENT,
  type CustomToolEditorActionEventDetail,
} from '@/widgets/events'
import { createEditorActionsHook, createEmitEditorAction } from '@/widgets/utils/editor-actions'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  emitCustomToolSelectionChange,
  useCustomToolSelectionPersistence,
} from '@/widgets/utils/custom-tool-selection'
import { CustomToolDropdown } from '@/widgets/widgets/components/custom-tool-dropdown'
import {
  EntityEditorHeaderButton,
  EntityEditorRedoButton,
  EntityEditorUndoButton,
} from '@/widgets/widgets/components/entity-editor-buttons'
import {
  EntityEditorShell,
  type EntityEditorShellConfig,
} from '@/widgets/widgets/components/entity-editor-shell'
import { useGuardedUndoRedo } from '@/widgets/widgets/entity_review/use-guarded-undo-redo'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import {
  CustomToolEditor,
  type CustomToolEditorSection,
} from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'
import {
  buildPersistedPairContext,
  buildPersistedReviewParams,
  CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  readEntitySelectionState,
  resolveCustomToolId,
} from '@/widgets/widgets/_shared/custom_tool/utils'


const emitCustomToolEditorAction = createEmitEditorAction<
  CustomToolEditorActionEventDetail['action']
>(CUSTOM_TOOL_EDITOR_ACTION_EVENT)

type CustomToolSimpleAction = 'save' | 'undo' | 'redo'

const useCustomToolSimpleActions =
  createEditorActionsHook<CustomToolSimpleAction>(CUSTOM_TOOL_EDITOR_ACTION_EVENT)

/**
 * Thin wrapper around the generic editor-actions hook that also handles the
 * `set-section` action (which carries an extra `section` payload).
 */
function useCustomToolEditorActions({
  panelId,
  widgetKey,
  onSave,
  onSectionChange,
  onUndo,
  onRedo,
}: {
  panelId?: string
  widgetKey?: string
  onSave?: () => void
  onSectionChange?: (section: CustomToolEditorSection) => void
  onUndo?: () => void
  onRedo?: () => void
}) {
  useCustomToolSimpleActions({
    panelId,
    widgetKey,
    save: onSave,
    undo: onUndo,
    redo: onRedo,
  })

  // Handle `set-section` separately because it carries an extra payload.
  const sectionChangeRef = useRef(onSectionChange)
  sectionChangeRef.current = onSectionChange

  useEffect(() => {
    const handleSection = (event: Event) => {
      const detail = (event as CustomEvent<CustomToolEditorActionEventDetail>).detail
      if (detail?.action !== 'set-section' || !detail.section) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widgetKey && detail.widgetKey && detail.widgetKey !== widgetKey) return
      sectionChangeRef.current?.(detail.section)
    }

    window.addEventListener(CUSTOM_TOOL_EDITOR_ACTION_EVENT, handleSection as EventListener)
    return () => {
      window.removeEventListener(CUSTOM_TOOL_EDITOR_ACTION_EVENT, handleSection as EventListener)
    }
  }, [panelId, widgetKey])
}

const CUSTOM_TOOL_SHELL_CONFIG: EntityEditorShellConfig = {
  entityKind: ENTITY_KIND_CUSTOM_TOOL,
  fallbackWidgetKey: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  legacyIdKey: 'customToolId',
  buildWidgetParams: buildPersistedReviewParams,
  buildPairContext: buildPersistedPairContext,
  readEntitySelectionState,
  noWorkspaceMessage: 'Select a workspace to edit custom tools.',
  noSelectionMessage: 'Select a custom tool to edit.',
}

function EditorCustomToolWidgetBody(props: WidgetComponentProps) {
  return (
    <EntityEditorShell
      {...props}
      config={CUSTOM_TOOL_SHELL_CONFIG}
      useSelectionPersistence={({
        resolvedPairColor,
        isLinkedToColorPair,
        pairContext,
        setPairContext,
        onWidgetParamsChange,
        panelId,
        params,
      }) => {
        useCustomToolSelectionPersistence({
          onWidgetParamsChange,
          panelId,
          params,
          pairColor: resolvedPairColor,
          scopeKey: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
          onCustomToolSelect: (customToolId) => {
            if (!isLinkedToColorPair) {
              return
            }

            if (pairContext?.customToolId === customToolId) {
              return
            }

            setPairContext(
              resolvedPairColor,
              buildPersistedPairContext({
                existing: pairContext,
                legacyIdKey: 'customToolId',
                descriptor: null,
                legacyEntityId: customToolId,
              })
            )
          },
        })
      }}
    >
      {({ workspaceId, descriptor, persistDescriptor, panelId, widget }) => (
        <CustomToolEditorSession
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

function CustomToolEditorSession({
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
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')
  const { doc, isLoading, error, undo, redo, runtime, canUndo, canRedo } = useEntitySession()
  const { handleUndo, handleRedo } = useGuardedUndoRedo({ runtime, undo, redo, canUndo, canRedo })

  useEffect(() => {
    setActiveSection('schema')
  }, [descriptor.reviewSessionId])

  const syncActiveSection = useCallback(
    (section: CustomToolEditorSection) => {
      setActiveSection(section)
      if (!panelId) {
        return
      }

      emitCustomToolEditorAction({
        action: 'set-section',
        section,
        panelId,
        widgetKey: widget?.key,
      })
    },
    [panelId, widget?.key]
  )

  useCustomToolEditorActions({
    panelId,
    widgetKey: widget?.key,
    onSave: () => saveRef.current(),
    onSectionChange: setActiveSection,
    onUndo: handleUndo,
    onRedo: handleRedo,
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
      <CustomToolEditor
        workspaceId={workspaceId}
        descriptor={descriptor}
        activeSection={activeSection}
        blockId={
          descriptor.reviewSessionId ??
          descriptor.draftSessionId ??
          descriptor.entityId ??
          'custom-tool-editor'
        }
        onSectionChange={syncActiveSection}
        saveRef={saveRef}
        yjsDoc={doc}
        onReviewTargetChange={onReviewTargetChange}
      />
    </div>
  )
}

type CustomToolEditorSelectorProps = {
  panelId?: string
  workspaceId?: string
  pairColor?: PairColor
  params?: Record<string, unknown> | null
  widgetKey?: string
}

function CustomToolEditorSelector({
  panelId,
  workspaceId,
  pairColor = 'gray',
  params,
  widgetKey,
}: CustomToolEditorSelectorProps) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const selectedToolId = isLinkedToColorPair
    ? resolveCustomToolId({ pairContext, params })
    : resolveCustomToolId({ params })

  const handleCustomToolChange = (customToolId: string | null) => {
    if (isLinkedToColorPair) {
      if (pairContext?.customToolId === customToolId) return
      setPairContext(
        resolvedPairColor,
        buildPersistedPairContext({
          existing: pairContext,
          legacyIdKey: 'customToolId',
          descriptor: null,
          legacyEntityId: customToolId,
        })
      )
      return
    }

    emitCustomToolSelectionChange({
      customToolId,
      panelId,
      widgetKey: widgetKey ?? CUSTOM_TOOL_EDITOR_WIDGET_KEY,
    })
  }

  return (
    <CustomToolDropdown
      workspaceId={workspaceId}
      value={selectedToolId}
      onChange={(customToolId) => handleCustomToolChange(customToolId)}
      placeholder='Select custom tool'
      triggerClassName='min-w-[240px]'
    />
  )
}

function useCustomToolSelectionState({
  params,
  pairColor,
}: {
  params?: Record<string, unknown> | null
  pairColor?: PairColor
}) {
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)

  return readEntitySelectionState({
    params,
    pairContext: resolvedPairColor !== 'gray' ? pairContext : null,
    legacyIdKey: 'customToolId',
  })
}

function useHasCustomToolSelection({
  params,
  pairColor,
}: {
  params?: Record<string, unknown> | null
  pairColor?: PairColor
}) {
  const selectionState = useCustomToolSelectionState({ params, pairColor })

  return (
    !!selectionState.legacyEntityId ||
    !!selectionState.reviewSessionId ||
    !!selectionState.reviewDraftSessionId
  )
}

function CustomToolEditorSectionTabs({
  panelId,
  params,
  pairColor = 'gray',
  widgetKey,
}: {
  panelId?: string
  params?: Record<string, unknown> | null
  pairColor?: PairColor
  widgetKey?: string
}) {
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')
  const isDisabled = !panelId || !useHasCustomToolSelection({ params, pairColor })

  useCustomToolEditorActions({
    panelId,
    widgetKey,
    onSectionChange: setActiveSection,
  })

  useEffect(() => {
    setActiveSection('schema')
  }, [params?.customToolId, params?.reviewSessionId, params?.reviewDraftSessionId])

  const selectSection = (section: CustomToolEditorSection) => {
    if (isDisabled) return

    setActiveSection(section)
    emitCustomToolEditorAction({
      action: 'set-section',
      section,
      panelId,
      widgetKey,
    })
  }

  return (
    <>
      <button
        type='button'
        disabled={isDisabled}
        className={widgetHeaderControlClassName(
          activeSection === 'schema'
            ? 'min-w-[72px] justify-center border-border bg-card px-2 text-foreground'
            : 'min-w-[72px] justify-center px-2 text-muted-foreground'
        )}
        onClick={() => selectSection('schema')}
        aria-pressed={activeSection === 'schema'}
      >
        Config
      </button>
      <button
        type='button'
        disabled={isDisabled}
        className={widgetHeaderControlClassName(
          activeSection === 'code'
            ? 'min-w-[72px] justify-center border-border bg-card px-2 text-foreground'
            : 'min-w-[72px] justify-center px-2 text-muted-foreground'
        )}
        onClick={() => selectSection('code')}
        aria-pressed={activeSection === 'code'}
      >
        Code
      </button>
    </>
  )
}

interface CustomToolEditorButtonProps {
  workspaceId?: string
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
  params?: Record<string, unknown> | null
}

/**
 * Internal helper that renders save / undo / redo buttons for the custom-tool
 * editor.  All three flavours share the same hook calls; only the rendered
 * button component differs.
 */
function CustomToolEditorActionButton({
  action,
  workspaceId,
  panelId,
  widgetKey,
  pairColor = 'gray',
  params,
}: CustomToolEditorButtonProps & { action: 'save' | 'undo' | 'redo' }) {
  const selectionState = useCustomToolSelectionState({ params, pairColor })
  const hasSelection =
    !!selectionState.legacyEntityId ||
    !!selectionState.reviewSessionId ||
    !!selectionState.reviewDraftSessionId
  const emitAction = () => emitCustomToolEditorAction({ action, panelId, widgetKey })

  switch (action) {
    case 'save':
      return (
        <EntityEditorHeaderButton
          tooltip='Save custom tool'
          label='Save custom tool'
          icon={Save}
          disabled={!workspaceId || !hasSelection || !panelId}
          variant='default'
          onClick={emitAction}
        />
      )
    case 'undo':
      return (
        <EntityEditorUndoButton
          reviewSessionId={selectionState.reviewSessionId}
          onAction={emitAction}
        />
      )
    case 'redo':
      return (
        <EntityEditorRedoButton
          reviewSessionId={selectionState.reviewSessionId}
          onAction={emitAction}
        />
      )
  }
}

function CustomToolEditorSaveButton(props: CustomToolEditorButtonProps) {
  return <CustomToolEditorActionButton action='save' {...props} />
}

function CustomToolEditorUndoButton(props: CustomToolEditorButtonProps) {
  return <CustomToolEditorActionButton action='undo' {...props} />
}

function CustomToolEditorRedoButton(props: CustomToolEditorButtonProps) {
  return <CustomToolEditorActionButton action='redo' {...props} />
}

export const editorCustomToolWidget: DashboardWidgetDefinition = {
  key: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  title: 'Custom Tool Editor',
  icon: SquareTerminal,
  category: 'editor',
  description: 'Edit workspace custom tools.',
  component: (props) => <EditorCustomToolWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const params =
      widget?.params && typeof widget.params === 'object'
        ? (widget.params as Record<string, unknown>)
        : null

    return {
      center: (
        <CustomToolEditorSelector
          panelId={panelId}
          workspaceId={context?.workspaceId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
          params={params}
        />
      ),
      right: (
        <div className={widgetHeaderButtonGroupClassName()}>
          <CustomToolEditorSectionTabs
            panelId={panelId}
            params={params}
            pairColor={widget?.pairColor}
            widgetKey={widget?.key}
          />
          <CustomToolEditorUndoButton
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
            params={params}
          />
          <CustomToolEditorRedoButton
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
            params={params}
          />
          <CustomToolEditorSaveButton
            workspaceId={context?.workspaceId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
            params={params}
          />
        </div>
      ),
    }
  },
}
