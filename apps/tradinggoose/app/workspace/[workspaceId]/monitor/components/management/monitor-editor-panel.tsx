'use client'

import { Pause, Pencil, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import type { MonitorReferenceData } from '../shared/types'
import { IndicatorInputSummary } from './indicator-input-fields'
import { MonitorEditorForm } from './monitor-editor-form'
import type { MonitorEditorState } from './use-monitor-editor-state'

type MonitorEditorPanelProps = {
  editorState: MonitorEditorState
  referenceData: MonitorReferenceData
  createDisabled?: boolean
}

function MonitorDetails({
  editorState,
  referenceData,
}: {
  editorState: MonitorEditorState
  referenceData: MonitorReferenceData
}) {
  const monitor = editorState.selectedMonitor
  if (!monitor) return null

  const monitorConfig = monitor.providerConfig.monitor
  const indicator = referenceData.indicatorById[monitorConfig.indicatorId]
  const workflowTarget =
    referenceData.workflowTargetByKey[`${monitor.workflowId}:${monitor.blockId}`]

  return (
    <Card className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card/60'>
      <CardHeader className='shrink-0 border-b px-4 py-3'>
        <CardTitle className='font-medium text-sm'>
          {indicator?.name ?? monitorConfig.indicatorId}
        </CardTitle>
        <CardDescription className='text-xs'>
          {workflowTarget?.label ?? `${monitor.workflowId}:${monitor.blockId}`}
        </CardDescription>
        {editorState.panelError ? (
          <p className='mt-2 text-destructive text-xs'>{editorState.panelError}</p>
        ) : null}
      </CardHeader>

      <CardContent className='min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm'>
        <div className='grid grid-cols-2 gap-2'>
          <div className='rounded-md border p-2'>
            <div className='text-muted-foreground text-xs'>Provider</div>
            <div>
              {referenceData.providerById[monitorConfig.providerId]?.name ??
                monitorConfig.providerId}
            </div>
          </div>
          <div className='rounded-md border p-2'>
            <div className='text-muted-foreground text-xs'>Interval</div>
            <div>{monitorConfig.interval}</div>
          </div>
          <div className='rounded-md border p-2'>
            <div className='text-muted-foreground text-xs'>Status</div>
            <div>{monitor.isActive ? 'Active' : 'Paused'}</div>
          </div>
          <div className='rounded-md border p-2'>
            <div className='text-muted-foreground text-xs'>Monitor ID</div>
            <div className='truncate'>{monitor.monitorId}</div>
          </div>
        </div>
        <IndicatorInputSummary
          inputMeta={indicator?.inputMeta}
          sparseInputs={monitorConfig.indicatorInputs ?? {}}
        />
      </CardContent>

      <CardFooter className='grid shrink-0 grid-cols-2 gap-2 border-t p-3'>
        <Button variant='outline' size='sm' onClick={() => editorState.openEdit(monitor)}>
          <Pencil className='mr-1 h-4 w-4' />
          Edit
        </Button>
        <Button
          variant='outline'
          size='sm'
          onClick={() => void editorState.toggleMonitorState(monitor)}
          disabled={editorState.togglingMonitorId === monitor.monitorId}
        >
          {monitor.isActive ? (
            <Pause className='mr-1 h-4 w-4' />
          ) : (
            <Play className='mr-1 h-4 w-4' />
          )}
          {monitor.isActive ? 'Pause' : 'Resume'}
        </Button>
        <Button
          variant='destructive'
          size='sm'
          className='col-span-2'
          onClick={() => void editorState.removeMonitor(monitor.monitorId)}
          disabled={editorState.deletingMonitorId === monitor.monitorId}
        >
          <Trash2 className='mr-1 h-4 w-4' />
          Delete
        </Button>
      </CardFooter>
    </Card>
  )
}

function EditorContent({
  createDisabled = false,
  editorState,
  referenceData,
}: MonitorEditorPanelProps) {
  if (editorState.isEditorOpen && editorState.editingDraft) {
    return (
      <Card className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card/60 p-3'>
        <CardHeader className='shrink-0 p-0 pb-3'>
          <CardTitle className='font-medium text-sm'>
            {editorState.editingKey ? 'Edit Monitor' : 'Create Monitor'}
          </CardTitle>
          <CardDescription className='text-xs'>
            Configure provider, listing, indicator, workflow target, and inputs.
          </CardDescription>
          {editorState.panelError ? (
            <p className='mt-2 text-destructive text-xs'>{editorState.panelError}</p>
          ) : null}
        </CardHeader>
        <MonitorEditorForm
          editingKey={editorState.editingKey}
          draft={editorState.editingDraft}
          errors={editorState.editingErrors}
          saving={editorState.saving}
          streamingProviders={referenceData.streamingProviders}
          providerIntervals={
            referenceData.providerIntervalsByProviderId[editorState.editingDraft.providerId] ?? []
          }
          providerIntervalsByProviderId={referenceData.providerIntervalsByProviderId}
          defaultDraftInterval={referenceData.defaultDraftInterval}
          workflowTargets={referenceData.workflowTargets}
          indicatorPickerOptions={referenceData.indicatorOptions}
          indicatorInputMeta={editorState.editingIndicatorInputMeta}
          nonSecretDefinitions={editorState.editingNonSecretDefinitions}
          secretDefinitions={editorState.editingSecretDefinitions}
          listingInstanceId={editorState.editingListingInstanceId}
          onCancel={editorState.closeEditor}
          onSave={() => void editorState.persistDraft()}
          onUpdateDraft={editorState.updateDraft}
          onUpdateSecretValue={editorState.updateSecretValue}
          onUpdateProviderParamValue={editorState.updateProviderParamValue}
          onUpdateIndicatorInputs={editorState.updateIndicatorInputs}
        />
      </Card>
    )
  }

  if (editorState.selectedMonitor) {
    return <MonitorDetails editorState={editorState} referenceData={referenceData} />
  }

  return null
}

export function MonitorEditorPanel({
  createDisabled = false,
  editorState,
  referenceData,
}: MonitorEditorPanelProps) {
  const isMobile = useIsMobile()
  const content = (
    <EditorContent
      editorState={editorState}
      referenceData={{
        ...referenceData,
        createDisabledReason:
          createDisabled && !referenceData.createDisabledReason
            ? 'Monitor requirements are still loading.'
            : referenceData.createDisabledReason,
      }}
    />
  )

  if (isMobile) {
    const open = editorState.isEditorOpen || Boolean(editorState.selectedMonitor)
    return (
      <Sheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            editorState.closeEditor()
            editorState.clearSelection()
          }
        }}
      >
        <SheetContent side='right' className='w-[92vw] p-3 sm:max-w-xl'>
          {content}
        </SheetContent>
      </Sheet>
    )
  }

  return content
}
