'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Save, SquareTerminal } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useEntityList, useSavedEntityYjsSession } from '@/lib/yjs/use-entity-fields'
import type { LocaleCode } from '@/i18n/utils'
import {
  CUSTOM_TOOL_EDITOR_ACTION_EVENT,
  type CustomToolEditorActionEventDetail,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { resolveCustomToolId } from '@/widgets/widgets/_shared/custom_tool/utils'
import { CustomToolDropdown } from '@/widgets/widgets/components/custom-tool-dropdown'
import { customToolEditorWidgetContract } from '@/widgets/widgets/editor_custom_tool/contract'
import {
  CustomToolEditor,
  type CustomToolEditorSection,
} from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

function emitCustomToolEditorAction(detail: CustomToolEditorActionEventDetail) {
  window.dispatchEvent(
    new CustomEvent<CustomToolEditorActionEventDetail>(CUSTOM_TOOL_EDITOR_ACTION_EVENT, {
      detail,
    })
  )
}

function useCustomToolEditorActions({
  panelId,
  widgetKey,
  onExport,
  onSave,
  onSectionChange,
}: {
  panelId?: string
  widgetKey?: string
  onExport?: () => void
  onSave?: () => void
  onSectionChange?: (section: CustomToolEditorSection) => void
}) {
  const exportRef = useRef(onExport)
  const saveRef = useRef(onSave)
  const sectionChangeRef = useRef(onSectionChange)

  exportRef.current = onExport
  saveRef.current = onSave
  sectionChangeRef.current = onSectionChange

  useEffect(() => {
    if (!panelId) return

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<CustomToolEditorActionEventDetail>).detail
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widgetKey && detail.widgetKey && detail.widgetKey !== widgetKey) return

      if (detail.action === 'export') {
        exportRef.current?.()
        return
      }

      if (detail.action === 'save') {
        saveRef.current?.()
        return
      }

      if (detail.action === 'set-section' && detail.section) {
        sectionChangeRef.current?.(detail.section)
      }
    }

    window.addEventListener(CUSTOM_TOOL_EDITOR_ACTION_EVENT, handleAction as EventListener)

    return () => {
      window.removeEventListener(CUSTOM_TOOL_EDITOR_ACTION_EVENT, handleAction as EventListener)
    }
  }, [panelId, widgetKey])
}

function EditorCustomToolWidgetBody({
  context,
  params,
  pairColor = 'gray',
  onWidgetParamsPatch,
  panelId,
  widget,
}: WidgetComponentProps) {
  const copy = useMessages().workspace.widgets.customToolEditor
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const exportRef = useRef<() => void>(() => {})
  const saveRef = useRef<() => void>(() => {})
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')

  const paramsCustomToolId = resolveCustomToolId({ params })
  const requestedCustomToolId = paramsCustomToolId
  const normalizedRequestedCustomToolId = requestedCustomToolId?.trim() ?? ''
  const hasRequestedCustomTool = normalizedRequestedCustomToolId.length > 0
  const {
    members: customToolMembers,
    isLoading: isCustomToolListLoading,
    error: customToolListError,
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
      if (!panelId) return

      emitCustomToolEditorAction({
        action: 'set-section',
        section,
        panelId,
        widgetKey: widget?.key,
      })
    },
    [panelId, widget?.key]
  )

  const customToolSession = useSavedEntityYjsSession('custom_tool', selectedToolId, workspaceId)

  useEffect(() => {
    if (!selectedToolId) {
      return
    }

    syncActiveSection('schema')
  }, [selectedToolId, syncActiveSection])

  useCustomToolEditorActions({
    onExport: () => exportRef.current(),
    panelId,
    widgetKey: widget?.key,
    onSave: () => saveRef.current(),
    onSectionChange: setActiveSection,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message={copy.body.selectWorkspace} />
  }

  if (customToolListError && customToolMembers.length === 0) {
    return <WidgetStateMessage message={customToolListError} />
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
    return <WidgetStateMessage message={customToolSession.error} />
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
          exportRef={exportRef}
          saveRef={saveRef}
          blockId='dashboard-custom-tool-editor'
        />
      </div>
    </WorkflowRouteProvider>
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
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolEditor.header
  const actions = useWidgetConfigRuntimeActions()

  const selectedToolId = resolveCustomToolId({ params })

  const handleCustomToolChange = (customToolId: string | null) => {
    actions.patchWidgetParams({ customToolId })
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

const CUSTOM_TOOL_EDITOR_SECTIONS: Array<{ id: CustomToolEditorSection; label: string }> = [
  { id: 'schema', label: 'Config' },
  { id: 'code', label: 'Code' },
]

function CustomToolEditorSectionSwitch({
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
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolEditor.header
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')
  const customToolId = resolveCustomToolId({ params })
  const isDisabled = !customToolId || !panelId

  useCustomToolEditorActions({
    panelId,
    widgetKey,
    onSectionChange: setActiveSection,
  })

  useEffect(() => {
    setActiveSection('schema')
  }, [customToolId])

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
    <div className='flex h-7 items-center gap-1 rounded-sm border border-border/70 bg-card/60 p-1'>
      {CUSTOM_TOOL_EDITOR_SECTIONS.map((section) => {
        const isSelected = section.id === activeSection

        return (
          <Button
            key={section.id}
            type='button'
            variant={isSelected ? 'default' : 'ghost'}
            size='sm'
            className='h-5 min-w-14 rounded-xs px-3 text-sm'
            disabled={isDisabled}
            onClick={() => selectSection(section.id)}
            aria-pressed={isSelected}
          >
            {section.id === 'schema' ? copy.config : copy.code}
          </Button>
        )
      })}
    </div>
  )
}

function CustomToolEditorSaveButton({
  workspaceId,
  customToolId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: {
  workspaceId?: string
  customToolId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolEditor.header
  const resolvedCustomToolId = customToolId ?? null
  const saveDisabled = !workspaceId || !resolvedCustomToolId || !panelId

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='default'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={() => {
              emitCustomToolEditorAction({
                action: 'save',
                panelId,
                widgetKey,
              })
            }}
            disabled={saveDisabled}
          >
            <Save className='h-4 w-4' />
            <span className='sr-only'>{copy.saveCustomTool}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{copy.saveCustomTool}</TooltipContent>
    </Tooltip>
  )
}

function CustomToolEditorExportButton({
  workspaceId,
  customToolId,
  panelId,
  widgetKey,
  pairColor = 'gray',
}: {
  workspaceId?: string
  customToolId?: string | null
  panelId?: string
  widgetKey?: string
  pairColor?: PairColor
}) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.customToolEditor.header
  const resolvedCustomToolId = customToolId ?? null
  const exportDisabled = !workspaceId || !resolvedCustomToolId || !panelId

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='h-7 w-7 text-xs'
            onClick={() => {
              emitCustomToolEditorAction({
                action: 'export',
                panelId,
                widgetKey,
              })
            }}
            disabled={exportDisabled}
          >
            <Download className='h-4 w-4' />
            <span className='sr-only'>{copy.exportCustomTool}</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>{copy.exportCustomTool}</TooltipContent>
    </Tooltip>
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
          panelId={panelId}
          workspaceId={context?.workspaceId}
          pairColor={widget?.pairColor}
          widgetKey={widget?.key}
          params={
            widget?.params && typeof widget.params === 'object'
              ? (widget.params as Record<string, unknown>)
              : null
          }
        />
      ),
      right: (
        <div className={widgetHeaderButtonGroupClassName()}>
          <CustomToolEditorSectionSwitch
            panelId={panelId}
            params={
              widget?.params && typeof widget.params === 'object'
                ? (widget.params as Record<string, unknown>)
                : null
            }
            pairColor={widget?.pairColor}
            widgetKey={widget?.key}
          />
          <CustomToolEditorExportButton
            workspaceId={context?.workspaceId}
            customToolId={customToolId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
          <CustomToolEditorSaveButton
            workspaceId={context?.workspaceId}
            customToolId={customToolId}
            panelId={panelId}
            widgetKey={widget?.key}
            pairColor={widget?.pairColor}
          />
        </div>
      ),
    }
  },
}
