import { useEffect } from 'react'
import { resolveEntityId } from '@/widgets/widget-contracts'

export function usePersistResolvedEntityId({
  entityId,
  entityIdKey,
  onWidgetParamsPatch,
  params,
}: {
  entityId?: string | null
  entityIdKey: string
  onWidgetParamsPatch?: (params: Record<string, unknown>) => void
  params?: Record<string, unknown> | null
}) {
  useEffect(() => {
    if (!entityId) return
    if (!onWidgetParamsPatch) return

    const currentEntityId = resolveEntityId(entityIdKey, { params })
    if (currentEntityId === entityId) return

    onWidgetParamsPatch({ [entityIdKey]: entityId })
  }, [entityId, entityIdKey, onWidgetParamsPatch, params])
}
