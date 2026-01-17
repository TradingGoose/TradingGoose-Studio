import type { ClientToolDisplay } from '@/lib/copilot/tools/client/base-tool'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getTool } from '@/lib/copilot/tools/client/registry'
import { CLASS_TOOL_METADATA } from '@/stores/copilot/tool-registry'

// Resolve display text/icon for a tool based on its state
export function resolveToolDisplay(
  toolName: string | undefined,
  state: ClientToolCallState,
  toolCallId?: string,
  params?: Record<string, any>
): ClientToolDisplay | undefined {
  try {
    if (!toolName) return undefined
    const def = getTool(toolName) as any
    const toolMetadata = def?.metadata || CLASS_TOOL_METADATA[toolName]
    const meta = toolMetadata?.displayNames || {}
    // Exact state first
    const ds = meta?.[state]
    if (ds?.text || ds?.icon) {
      // Check if tool has a dynamic text formatter
      const getDynamicText = toolMetadata?.getDynamicText
      if (getDynamicText && params) {
        try {
          const dynamicText = getDynamicText(params, state)
          if (dynamicText) {
            return { text: dynamicText, icon: ds.icon }
          }
        } catch {}
      }
      return { text: ds.text, icon: ds.icon }
    }
    // Fallback order (prefer pre-execution states for unknown states like pending)
    const fallbackOrder: ClientToolCallState[] = [
      (ClientToolCallState as any).generating,
      (ClientToolCallState as any).executing,
      (ClientToolCallState as any).review,
      (ClientToolCallState as any).success,
      (ClientToolCallState as any).error,
      (ClientToolCallState as any).rejected,
    ]
    for (const key of fallbackOrder) {
      const cand = meta?.[key]
      if (cand?.text || cand?.icon) return { text: cand.text, icon: cand.icon }
    }
  } catch { }
  // Humanized fallback as last resort
  try {
    if (toolName) {
      const text = toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      return { text, icon: undefined as any }
    }
  } catch { }
  return undefined
}

// Helper: check if a tool state is rejected
export function isRejectedState(state: any): boolean {
  try {
    return state === 'rejected' || state === (ClientToolCallState as any).rejected
  } catch {
    return state === 'rejected'
  }
}

// Helper: check if a tool state is review (terminal for build/edit preview)
export function isReviewState(state: any): boolean {
  try {
    return state === 'review' || state === (ClientToolCallState as any).review
  } catch {
    return state === 'review'
  }
}

// Helper: check if a tool state is background (terminal)
export function isBackgroundState(state: any): boolean {
  try {
    return state === 'background' || state === (ClientToolCallState as any).background
  } catch {
    return state === 'background'
  }
}
