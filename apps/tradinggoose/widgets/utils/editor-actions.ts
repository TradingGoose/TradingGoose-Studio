import { useEffect } from 'react'
import { useLatestRef } from '@/hooks/use-latest-ref'
import type { WidgetInstance } from '@/widgets/layout'

/**
 * Generic factory for editor-action hooks.
 *
 * Every entity editor (indicator, skill, mcp, custom-tool) follows the same
 * pattern: listen for a CustomEvent on `window`, match by panelId / widgetKey,
 * and dispatch to the appropriate callback based on `detail.action`.
 *
 * This factory eliminates that duplication.
 */

// ── Hook factory ────────────────────────────────────────────────────────────

type ActionCallbacks<A extends string> = Partial<Record<A, () => void>>

interface UseEditorActionsBaseOptions {
  panelId?: string
  widget?: WidgetInstance | null
  /** Optional plain widgetKey (used when no widget object is available). */
  widgetKey?: string
}

export type UseEditorActionsOptions<A extends string> = UseEditorActionsBaseOptions &
  ActionCallbacks<A>

/**
 * Creates a hook that listens for a specific CustomEvent and dispatches to
 * the matching action callback.
 *
 * ```ts
 * export const useIndicatorEditorActions = createEditorActionsHook<
 *   'save' | 'verify' | 'undo' | 'redo'
 * >(INDICATOR_EDITOR_ACTION_EVENT)
 * ```
 */
export function createEditorActionsHook<A extends string>(eventName: string) {
  return function useEditorActions(options: UseEditorActionsOptions<A>) {
    const { panelId, widget, widgetKey: rawWidgetKey, ...callbacks } = options
    const resolvedWidgetKey = widget?.key ?? rawWidgetKey

    // Keep stable refs for every callback so the effect doesn't re-run on
    // every render.
    const callbacksRef = useLatestRef(callbacks as unknown as ActionCallbacks<A>)

    useEffect(() => {
      const handleAction = (event: Event) => {
        const detail = (event as CustomEvent<{ action: A; panelId?: string; widgetKey?: string }>)
          .detail
        if (!detail?.action) return
        if (panelId && detail.panelId && detail.panelId !== panelId) return
        if (resolvedWidgetKey && detail.widgetKey && detail.widgetKey !== resolvedWidgetKey) return

        callbacksRef.current[detail.action]?.()
      }

      window.addEventListener(eventName, handleAction as EventListener)
      return () => {
        window.removeEventListener(eventName, handleAction as EventListener)
      }
    }, [panelId, resolvedWidgetKey])
  }
}

// ── Emit helper factory ─────────────────────────────────────────────────────

export interface EmitEditorActionOptions<A extends string> {
  action: A
  panelId?: string
  widgetKey?: string
}

/**
 * Creates a type-safe emit function for a specific editor action event.
 *
 * ```ts
 * export const emitIndicatorEditorAction = createEmitEditorAction<
 *   'save' | 'verify' | 'undo' | 'redo'
 * >(INDICATOR_EDITOR_ACTION_EVENT)
 * ```
 */
export function createEmitEditorAction<A extends string>(eventName: string) {
  return function emitEditorAction(options: EmitEditorActionOptions<A> & Record<string, unknown>) {
    window.dispatchEvent(new CustomEvent(eventName, { detail: options }))
  }
}
