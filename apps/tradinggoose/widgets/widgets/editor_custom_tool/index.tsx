'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, Save, SquareTerminal } from 'lucide-react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  CUSTOM_TOOL_EDITOR_ACTION_EVENT,
  type CustomToolEditorActionEventDetail,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { emitEditorAction, useEditorActions } from '@/widgets/utils/editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { resolveCustomToolId } from '@/widgets/widgets/_shared/custom_tool/utils'
import { CustomToolDropdown } from '@/widgets/widgets/components/custom-tool-dropdown'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { customToolEditorWidgetContract } from '@/widgets/widgets/editor_custom_tool/contract'
import {
  CustomToolEditor,
  type CustomToolEditorSection,
} from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

function EditorCustomToolWidgetBody({
  context,
  params,
  pairColor = 'gray',
  panelId,
  widget,
}: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.customToolEditor
  const workspaceId = context?.workspaceId ?? null
  const { canEdit, isLoading: isPermissionsLoading } = useUserPermissionsContext()
  const canEditEntity = !isPermissionsLoading && canEdit
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')

  const paramsCustomToolId = resolveCustomToolId({ params })
  const requestedCustomToolId = paramsCustomToolId
  const normalizedRequestedCustomToolId = requestedCustomToolId?.trim() ?? ''
  const hasRequestedCustomTool = normalizedRequestedCustomToolId.length > 0
  const {
    members: customToolMembers,
    isLoading: isCustomToolListLoading,
    isRetrying: isCustomToolListRetrying,
    error: customToolListError,
    retry: retryCustomToolList,
  } = useEntityList('custom_tool', workspaceId)
  const requestedCustomToolMember = hasRequestedCustomTool
    ? customToolMembers.find((member) => member.entityId === normalizedRequestedCustomToolId)
    : null
  const selectedToolId = resolveEntityIdFromList({
    requestedEntityId: requestedCustomToolId,
    entityIds: customToolMembers.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const selectedToolMember =
    customToolMembers.find((member) => member.entityId === selectedToolId) ?? null

  const syncActiveSection = useCallback(
    (section: CustomToolEditorSection) => {
      setActiveSection(section)
      if (!panelId || !selectedToolId) return

      emitEditorAction<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
        action: 'set-section',
        entityId: selectedToolId,
        section,
        panelId,
        widgetKey: widget?.key,
      })
    },
    [panelId, selectedToolId, widget?.key]
  )

  const customToolSession = useSavedEntityYjsSession(
    'custom_tool',
    isPermissionsLoading ? null : selectedToolId,
    isPermissionsLoading ? null : workspaceId,
    null,
    canEditEntity ? 'write' : 'read'
  )

  useEffect(() => {
    if (!selectedToolId) {
      return
    }

    syncActiveSection('schema')
  }, [selectedToolId, syncActiveSection])

  useEditorActions<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
    panelId,
    widgetKey: widget?.key,
    entityId: selectedToolId ?? undefined,
    'set-section': selectedToolId
      ? (detail) => {
          if (detail.section) setActiveSection(detail.section)
        }
      : undefined,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.body.selectWorkspace} />
  }

  if (customToolListError && customToolMembers.length === 0) {
    return (
      <WidgetStateMessage
        message={copy.body.failedToLoadCustomTools}
        variant='error'
        onRetry={retryCustomToolList}
        isRetrying={isCustomToolListRetrying}
      />
    )
  }

  if (
    hasRequestedCustomTool &&
    !isCustomToolListLoading &&
    !customToolListError &&
    !requestedCustomToolMember &&
    !selectedToolId
  ) {
    return <WidgetStateMessage message={copy.body.customToolNotFound} />
  }

  if (customToolSession.error) {
    return (
      <WidgetStateMessage
        message={copy.body.failedToLoadCustomTools}
        variant='error'
        onRetry={customToolSession.retry}
        isRetrying={customToolSession.isRetrying}
      />
    )
  }

  if (isCustomToolListLoading || customToolSession.isLoading) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!selectedToolId) {
    return (
      <WidgetStateMessage
        message={
          resolvedPairColor !== 'gray'
            ? copy.body.noSharedCustomToolSelected
            : copy.body.noCustomToolsYet
        }
      />
    )
  }

  return (
    <WorkflowRouteProvider workspaceId={workspaceId} workflowId='dashboard-custom-tool-editor'>
      <div className='flex h-full w-full flex-col overflow-hidden'>
        <CustomToolEditor
          activeSection={activeSection}
          doc={customToolSession.doc}
          save={customToolSession.save}
          toolId={selectedToolId}
          toolTitle={selectedToolMember?.entityName ?? ''}
          onSectionChange={syncActiveSection}
          panelId={panelId}
          widgetKey={widget?.key}
          blockId='dashboard-custom-tool-editor'
          readOnly={!canEditEntity}
        />
      </div>
    </WorkflowRouteProvider>
  )
}

type CustomToolEditorSelectorProps = {
  workspaceId?: string
  params?: Record<string, unknown> | null
}

function CustomToolEditorSelector({ workspaceId, params }: CustomToolEditorSelectorProps) {
  const copy = useMessages().workspace.widgets.customToolEditor.header
  const actions = useWidgetConfigRuntimeActions()

  const selectedToolId = resolveCustomToolId({ params })

  const handleCustomToolChange = (customToolId: string | null) => {
    actions.patchWidgetLinkedParams?.({ customToolId })
  }

  return (
    <CustomToolDropdown
      workspaceId={workspaceId}
      value={selectedToolId}
      onChange={(customToolId) => handleCustomToolChange(customToolId)}
      placeholder={copy.selectCustomTool}
      triggerClassName='min-w-[240px]'
    />
  )
}

const CUSTOM_TOOL_EDITOR_SECTIONS: CustomToolEditorSection[] = ['schema', 'code']

function CustomToolEditorActionControls({
  workspaceId,
  requestedEntityId,
  panelId,
  widgetKey,
}: {
  workspaceId?: string
  requestedEntityId: string | null
  panelId?: string
  widgetKey?: string
}) {
  const copy = useMessages().workspace.widgets.customToolEditor.header
  const { canEdit } = useUserPermissionsContext()
  const { members } = useEntityList('custom_tool', workspaceId)
  const entityId = resolveEntityIdFromList({
    requestedEntityId,
    entityIds: members.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')
  const controlsDisabled = !entityId || !panelId
  const exportDisabled = !workspaceId || controlsDisabled

  useEditorActions<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
    panelId,
    widgetKey,
    entityId: entityId ?? undefined,
    'set-section': entityId
      ? (detail) => {
          if (detail.section) setActiveSection(detail.section)
        }
      : undefined,
  })

  useEffect(() => setActiveSection('schema'), [entityId])

  const emitAction = (detail: Pick<CustomToolEditorActionEventDetail, 'action' | 'section'>) => {
    if (!entityId) return
    emitEditorAction<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
      ...detail,
      entityId,
      panelId,
      widgetKey,
    })
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <div className='flex h-7 items-center gap-1 rounded-sm border border-border/70 bg-card/60 p-1'>
        {CUSTOM_TOOL_EDITOR_SECTIONS.map((section) => (
          <Button
            key={section}
            type='button'
            variant={section === activeSection ? 'default' : 'ghost'}
            size='sm'
            className='h-5 min-w-14 rounded-xs px-3 text-sm'
            disabled={controlsDisabled}
            onClick={() => {
              setActiveSection(section)
              emitAction({ action: 'set-section', section })
            }}
            aria-pressed={section === activeSection}
          >
            {section === 'schema' ? copy.config : copy.code}
          </Button>
        ))}
      </div>
      <EntityEditorHeaderButton
        tooltip={copy.exportCustomTool}
        label={copy.exportCustomTool}
        icon={Download}
        disabled={exportDisabled}
        variant='outline'
        onClick={() => emitAction({ action: 'export' })}
      />
      <EntityEditorHeaderButton
        tooltip={copy.saveCustomTool}
        label={copy.saveCustomTool}
        icon={Save}
        disabled={!canEdit || exportDisabled}
        variant='default'
        onClick={() => emitAction({ action: 'save' })}
      />
    </div>
  )
}

export const editorCustomToolWidget: DashboardWidgetDefinition = {
  contract: customToolEditorWidgetContract,
  icon: SquareTerminal,
  component: (props) => <EditorCustomToolWidgetBody {...props} />,
  renderHeader: ({ widget, context, panelId }) => {
    const customToolId =
      widget?.params && typeof widget.params === 'object'
        ? resolveCustomToolId({ params: widget.params as Record<string, unknown> })
        : null

    return {
      center: (
        <CustomToolEditorSelector
          workspaceId={context?.workspaceId}
          params={
            widget?.params && typeof widget.params === 'object'
              ? (widget.params as Record<string, unknown>)
              : null
          }
        />
      ),
      right: (
        <CustomToolEditorActionControls
          workspaceId={context?.workspaceId}
          requestedEntityId={customToolId}
          panelId={panelId}
          widgetKey={widget?.key}
        />
      ),
    }
  },
}
