import { isPairColor, type PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'

type WidgetChannelInput = Pick<WidgetComponentProps, 'pairColor' | 'panelId' | 'widget'> & {
  fallbackWidgetKey: string
}

type ResolvedWidgetChannel = {
  resolvedPairColor: PairColor
  channelId: string
  widgetKey: string
}

export const resolveWidgetChannel = ({
  pairColor,
  widget,
  panelId,
  fallbackWidgetKey,
}: WidgetChannelInput): ResolvedWidgetChannel => {
  const widgetPairColor = isPairColor(widget?.pairColor) ? widget?.pairColor : null
  const resolvedPairColor = widgetPairColor ?? (isPairColor(pairColor) ? pairColor : 'gray')
  const widgetKey = widget?.key ?? fallbackWidgetKey
  const normalizedPanelId = panelId && panelId.trim().length > 0 ? panelId : 'panel'
  const channelId =
    resolvedPairColor !== 'gray'
      ? `pair-${resolvedPairColor}`
      : `${widgetKey}-${normalizedPanelId}`

  return {
    resolvedPairColor,
    channelId,
    widgetKey,
  }
}

type UseWidgetChannelOptions = Pick<WidgetComponentProps, 'context'> & WidgetChannelInput

export const useWidgetChannel = ({
  context,
  pairColor,
  panelId,
  widget,
  fallbackWidgetKey,
}: UseWidgetChannelOptions) => {
  const { resolvedPairColor, channelId, widgetKey } = resolveWidgetChannel({
    pairColor,
    panelId,
    widget,
    fallbackWidgetKey,
  })

  return {
    workspaceId: context?.workspaceId,
    resolvedPairColor,
    channelId,
    widgetKey,
    isLinkedToColorPair: resolvedPairColor !== 'gray',
  }
}
