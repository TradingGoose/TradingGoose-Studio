'use client'

import { Check, Download, Save } from 'lucide-react'
import { useMessages } from 'next-intl'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  INDICATOR_EDITOR_ACTION_EVENT,
  type IndicatorEditorActionEventDetail,
} from '@/widgets/events'
import { emitEditorAction } from '@/widgets/utils/editor-actions'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { resolveEntityIdFromList } from '@/widgets/widget-contracts'
import { EntityEditorHeaderButton } from '@/widgets/widgets/components/entity-editor-buttons'
import { IndicatorDropdown } from '@/widgets/widgets/components/pine-indicator-dropdown'

interface IndicatorEditorSelectorProps {
  workspaceId?: string
  indicatorId?: string | null
}

export function IndicatorEditorSelector({
  workspaceId,
  indicatorId,
}: IndicatorEditorSelectorProps) {
  const copy = useMessages().workspace.widgets.indicatorEditor.header
  const actions = useWidgetConfigRuntimeActions()
  const resolvedIndicatorId = indicatorId ?? null

  const handleIndicatorChange = (ids: string[]) => {
    const nextId = ids[0] ?? null
    actions.patchWidgetLinkedParams?.({ indicatorId: nextId })
  }

  return (
    <IndicatorDropdown
      workspaceId={workspaceId}
      value={resolvedIndicatorId ? [resolvedIndicatorId] : []}
      onChange={handleIndicatorChange}
      placeholder={copy.selectIndicator}
      selectionMode='single'
      triggerClassName='min-w-[220px]'
    />
  )
}

interface IndicatorEditorActionButtonProps {
  workspaceId?: string
  indicatorId?: string | null
  panelId?: string
  widgetKey?: string
}

export function IndicatorEditorActionButtons({
  workspaceId,
  indicatorId: requestedIndicatorId,
  panelId,
  widgetKey,
}: IndicatorEditorActionButtonProps) {
  const copy = useMessages().workspace.widgets.indicatorEditor.header
  const { canEdit } = useUserPermissionsContext()
  const { members } = useEntityList('indicator', workspaceId)
  const resolvedIndicatorId = resolveEntityIdFromList({
    requestedEntityId: requestedIndicatorId,
    entityIds: members.map((member) => member.entityId),
    useDefaultEntity: false,
  })
  const exportDisabled = !workspaceId || !resolvedIndicatorId
  const saveDisabled = !canEdit || exportDisabled

  return (
    <>
      <EntityEditorHeaderButton
        tooltip={copy.verifyIndicator}
        label={copy.verifyIndicator}
        icon={Check}
        disabled={exportDisabled}
        variant='secondary'
        onClick={() => {
          if (resolvedIndicatorId) {
            emitEditorAction<IndicatorEditorActionEventDetail>(INDICATOR_EDITOR_ACTION_EVENT, {
              action: 'verify',
              entityId: resolvedIndicatorId,
              panelId,
              widgetKey,
            })
          }
        }}
      />
      <EntityEditorHeaderButton
        tooltip={copy.exportIndicator}
        label={copy.exportIndicator}
        icon={Download}
        disabled={exportDisabled}
        onClick={() => {
          if (resolvedIndicatorId) {
            emitEditorAction<IndicatorEditorActionEventDetail>(INDICATOR_EDITOR_ACTION_EVENT, {
              action: 'export',
              entityId: resolvedIndicatorId,
              panelId,
              widgetKey,
            })
          }
        }}
      />
      <EntityEditorHeaderButton
        tooltip={copy.saveIndicator}
        label={copy.saveIndicator}
        icon={Save}
        disabled={saveDisabled}
        variant='default'
        onClick={() => {
          if (resolvedIndicatorId) {
            emitEditorAction<IndicatorEditorActionEventDetail>(INDICATOR_EDITOR_ACTION_EVENT, {
              action: 'save',
              entityId: resolvedIndicatorId,
              panelId,
              widgetKey,
            })
          }
        }}
      />
    </>
  )
}
