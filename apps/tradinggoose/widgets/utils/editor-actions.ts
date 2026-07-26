import { useEffect } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'

export type EditorActionEventDetail<A extends string> = {
  action: A
  panelId?: string
  widgetKey?: string
  entityId?: string
}

type ActionCallbacks<D extends EditorActionEventDetail<string>> = Partial<
  Record<D['action'], (detail: D) => void>
>

export type UseEditorActionsOptions<D extends EditorActionEventDetail<string>> = {
  panelId?: string
  widgetKey?: string
  entityId?: string
} & ActionCallbacks<D>

export function useEditorActions<D extends EditorActionEventDetail<string>>(
  eventName: string,
  options: UseEditorActionsOptions<D>
) {
  const { panelId, widgetKey, entityId, ...callbacks } = options
  const scopeRef = useLatestRef({ panelId, widgetKey, entityId })
  const callbacksRef = useLatestRef(callbacks as unknown as ActionCallbacks<D>)

  useEffect(() => {
    const handleAction = (event: Event) => {
      const detail = (event as CustomEvent<D>).detail
      if (!detail?.action) return
      const scope = scopeRef.current
      if (scope.panelId && detail.panelId && detail.panelId !== scope.panelId) return
      if (scope.widgetKey && detail.widgetKey && detail.widgetKey !== scope.widgetKey) return
      if (scope.entityId && detail.entityId !== scope.entityId) return
      callbacksRef.current[detail.action as D['action']]?.(detail)
    }

    window.addEventListener(eventName, handleAction as EventListener)
    return () => window.removeEventListener(eventName, handleAction as EventListener)
  }, [callbacksRef, eventName, scopeRef])
}

export function emitEditorAction<D extends EditorActionEventDetail<string>>(
  eventName: string,
  detail: D
) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}
