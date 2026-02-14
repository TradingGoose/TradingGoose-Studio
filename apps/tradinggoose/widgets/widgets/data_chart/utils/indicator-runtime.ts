import type { IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

export const resolveRuntimePaneIndex = (
  entry: IndicatorRuntimeEntry,
  fallbackPaneIndex: number
): number => {
  if (!entry.pane) return entry.paneIndex ?? fallbackPaneIndex
  try {
    return entry.pane.paneIndex()
  } catch {
    return entry.paneIndex ?? fallbackPaneIndex
  }
}
