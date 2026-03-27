'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Save, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useCustomTools } from '@/hooks/queries/custom-tools'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import { DEFAULT_WORKFLOW_CHANNEL_ID } from '@/stores/workflows/workflow/store-client'
import {
  CUSTOM_TOOL_EDITOR_ACTION_EVENT,
  type CustomToolEditorActionEventDetail,
} from '@/widgets/events'
import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition, WidgetComponentProps } from '@/widgets/types'
import {
  emitCustomToolSelectionChange,
  useCustomToolSelectionPersistence,
} from '@/widgets/utils/custom-tool-selection'
import { CustomToolDropdown } from '@/widgets/widgets/components/custom-tool-dropdown'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderControlClassName,
} from '@/widgets/widgets/components/widget-header-control'
import {
  CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  resolveCustomToolId,
} from '@/widgets/widgets/custom_tool/utils'
import {
  CustomToolEditor,
  type CustomToolEditorSection,
} from '@/widgets/widgets/editor_custom_tool/custom-tool-editor'
import { WidgetStateMessage } from '@/widgets/widgets/editor_indicator/components/widget-state-message'
import { WorkflowRouteProvider } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const sortCustomTools = (tools: CustomToolDefinition[]) =>
  [...tools].sort((a, b) => {
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '')
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '')
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
  })

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
  onSave,
  onSectionChange,
}: {
  panelId?: string
  widgetKey?: string
  onSave?: () => void
  onSectionChange?: (section: CustomToolEditorSection) => void
}) {
  const saveRef = useRef(onSave)
  const sectionChangeRef = useRef(onSectionChange)

  saveRef.current = onSave
  sectionChangeRef.current = onSectionChange

  useEffect(() => {
    if (!panelId) return

    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<CustomToolEditorActionEventDetail>).detail
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widgetKey && detail.widgetKey && detail.widgetKey !== widgetKey) return

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
  onWidgetParamsChange,
  panelId,
  widget,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const { data: queryTools = [], isLoading, error, refetch } = useCustomTools(workspaceId ?? '')
  const storedTools = useCustomToolsStore((state) =>
    workspaceId ? state.getAllTools(workspaceId) : []
  )
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const saveRef = useRef<() => void>(() => {})
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')

  const tools = useMemo(
    () => sortCustomTools(queryTools.length > 0 ? queryTools : storedTools),
    [queryTools, storedTools]
  )

  const paramsCustomToolId = resolveCustomToolId({ params })
  const requestedCustomToolId = isLinkedToColorPair
    ? (pairContext?.customToolId ?? paramsCustomToolId)
    : paramsCustomToolId
  const normalizedRequestedCustomToolId = requestedCustomToolId?.trim() ?? ''
  const hasRequestedTool =
    normalizedRequestedCustomToolId.length > 0 &&
    tools.some((tool) => tool.id === normalizedRequestedCustomToolId)
  const selectedToolId = hasRequestedTool ? normalizedRequestedCustomToolId : (tools[0]?.id ?? null)

  useCustomToolSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    params,
    pairColor: resolvedPairColor,
    scopeKey: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
    onCustomToolSelect: (customToolId) => {
      if (!isLinkedToColorPair) return
      if (pairContext?.customToolId === customToolId) return
      setPairContext(resolvedPairColor, { customToolId })
    },
  })

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

  const selectedTool = selectedToolId
    ? (tools.find((tool) => tool.id === selectedToolId) ?? null)
    : null

  useEffect(() => {
    if (!selectedToolId) return
    if (isLinkedToColorPair) {
      if (pairContext?.customToolId === selectedToolId) {
        return
      }

      setPairContext(resolvedPairColor, { customToolId: selectedToolId })
      return
    }

    if (!onWidgetParamsChange || paramsCustomToolId === selectedToolId) {
      return
    }

    onWidgetParamsChange({
      ...(params ?? {}),
      customToolId: selectedToolId,
    })
  }, [
    isLinkedToColorPair,
    onWidgetParamsChange,
    pairContext?.customToolId,
    params,
    paramsCustomToolId,
    resolvedPairColor,
    selectedToolId,
    setPairContext,
  ])

  useEffect(() => {
    if (!selectedTool?.id) {
      return
    }

    syncActiveSection('schema')
  }, [selectedTool?.id, syncActiveSection])

  useCustomToolEditorActions({
    panelId,
    widgetKey: widget?.key,
    onSave: () => saveRef.current(),
    onSectionChange: setActiveSection,
  })

  if (!workspaceId) {
    return <WidgetStateMessage message='Select a workspace to edit custom tools.' />
  }

  if (error && tools.length === 0) {
    return (
      <WidgetStateMessage
        message={error instanceof Error ? error.message : 'Failed to load custom tools.'}
      />
    )
  }

  if (isLoading && tools.length === 0) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
  }

  if (!selectedToolId) {
    return <WidgetStateMessage message='No custom tools yet.' />
  }

  if (!selectedTool) {
    return <WidgetStateMessage message='Custom tool not found.' />
  }

  return (
    <WorkflowRouteProvider
      workspaceId={workspaceId}
      workflowId='dashboard-custom-tool-editor'
      channelId={DEFAULT_WORKFLOW_CHANNEL_ID}
    >
      <div className='flex h-full w-full flex-col overflow-hidden'>
        <CustomToolEditor
          activeSection={activeSection}
          onSectionChange={syncActiveSection}
          onSave={() => {
            refetch().catch((refetchError) => {
              console.error('Failed to refresh custom tools after save', refetchError)
            })
          }}
          saveRef={saveRef}
          blockId='dashboard-custom-tool-editor'
          initialValues={{
            id: selectedTool.id,
            schema: selectedTool.schema,
            code: selectedTool.code || '',
          }}
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
      setPairContext(resolvedPairColor, { customToolId })
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
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const [activeSection, setActiveSection] = useState<CustomToolEditorSection>('schema')
  const customToolId = isLinkedToColorPair
    ? resolveCustomToolId({ pairContext, params })
    : resolveCustomToolId({ params })
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
    <>
      <button
        type='button'
        disabled={isDisabled}
        className={widgetHeaderControlClassName(
          cn(
            'min-w-[72px] justify-center px-2',
            activeSection === 'schema'
              ? 'border-border bg-card text-foreground'
              : 'text-muted-foreground'
          )
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
          cn(
            'min-w-[72px] justify-center px-2',
            activeSection === 'code'
              ? 'border-border bg-card text-foreground'
              : 'text-muted-foreground'
          )
        )}
        onClick={() => selectSection('code')}
        aria-pressed={activeSection === 'code'}
      >
        Code
      </button>
    </>
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
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)

  const resolvedCustomToolId = isLinkedToColorPair
    ? (pairContext?.customToolId ?? customToolId ?? null)
    : (customToolId ?? null)
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
            <span className='sr-only'>Save custom tool</span>
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side='top'>Save custom tool</TooltipContent>
    </Tooltip>
  )
}

export const editorCustomToolWidget: DashboardWidgetDefinition = {
  key: CUSTOM_TOOL_EDITOR_WIDGET_KEY,
  title: 'Custom Tool Editor',
  icon: SquareTerminal,
  category: 'editor',
  description: 'Edit workspace custom tools.',
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
          <CustomToolEditorSectionTabs
            panelId={panelId}
            params={
              widget?.params && typeof widget.params === 'object'
                ? (widget.params as Record<string, unknown>)
                : null
            }
            pairColor={widget?.pairColor}
            widgetKey={widget?.key}
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
