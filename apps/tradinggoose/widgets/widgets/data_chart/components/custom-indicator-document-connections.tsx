'use client'

import { useEffect } from 'react'
import { inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'
import type { EntityListMember } from '@/lib/yjs/entity-session'
import { useSavedEntityYjsSession, useYjsStringField } from '@/lib/yjs/use-entity-fields'
import type { IndicatorDocumentRuntimeSource } from '@/widgets/widgets/data_chart/types'

export const getCustomIndicatorConnectionKey = (workspaceId: string, entityId: string) =>
  `${workspaceId}:${entityId}`

type ConnectionChange = (key: string, indicator: IndicatorDocumentRuntimeSource | null) => void
type ConnectionFailureChange = (
  key: string,
  recovery: { retry: () => void; isRetrying: boolean } | null
) => void

function CustomIndicatorDocumentConnection({
  workspaceId,
  entityId,
  onChange,
  onFailureChange,
}: {
  workspaceId: string
  entityId: string
  onChange: ConnectionChange
  onFailureChange?: ConnectionFailureChange
}) {
  const { doc, error, isRetrying, retry } = useSavedEntityYjsSession(
    'indicator',
    entityId,
    workspaceId,
    null,
    'read'
  )
  const [pineCode] = useYjsStringField(doc, 'pineCode')
  const connectionKey = getCustomIndicatorConnectionKey(workspaceId, entityId)

  useEffect(
    () => () => {
      onChange(connectionKey, null)
      onFailureChange?.(connectionKey, null)
    },
    [connectionKey, onChange, onFailureChange]
  )

  useEffect(() => {
    onFailureChange?.(connectionKey, error ? { retry, isRetrying } : null)
  }, [connectionKey, error, isRetrying, onFailureChange, retry])

  useEffect(() => {
    if (!doc) return
    onChange(connectionKey, {
      id: entityId,
      pineCode,
      inputMeta: inferInputMetaFromPineCode(pineCode),
    })
  }, [connectionKey, doc, entityId, onChange, pineCode])

  return null
}

export function CustomIndicatorDocumentConnections({
  workspaceId,
  indicatorIds,
  members,
  onChange,
  onFailureChange,
}: {
  workspaceId: string | null
  indicatorIds: string[]
  members: EntityListMember[]
  onChange: ConnectionChange
  onFailureChange?: ConnectionFailureChange
}) {
  if (!workspaceId) return null
  const selectedIds = new Set(indicatorIds)

  return members
    .filter((member) => selectedIds.has(member.entityId))
    .map((member) => (
      <CustomIndicatorDocumentConnection
        key={getCustomIndicatorConnectionKey(workspaceId, member.entityId)}
        workspaceId={workspaceId}
        entityId={member.entityId}
        onChange={onChange}
        onFailureChange={onFailureChange}
      />
    ))
}
