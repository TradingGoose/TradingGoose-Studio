import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import { LineToolArrow } from '@/widgets/widgets/data_chart/plugins/arrow'
import { LineToolBrush } from '@/widgets/widgets/data_chart/plugins/brush'
import { LineToolCallout } from '@/widgets/widgets/data_chart/plugins/callout'
import { LineToolCircle } from '@/widgets/widgets/data_chart/plugins/circle'
import type { ILineToolsPlugin } from '@/widgets/widgets/data_chart/plugins/core'
import { LineToolCrossLine } from '@/widgets/widgets/data_chart/plugins/cross-line'
import { LineToolExtendedLine } from '@/widgets/widgets/data_chart/plugins/extended-line'
import { LineToolFibRetracement } from '@/widgets/widgets/data_chart/plugins/fib-retracement'
import { LineToolHighlighter } from '@/widgets/widgets/data_chart/plugins/highlighter'
import { LineToolHorizontalLine } from '@/widgets/widgets/data_chart/plugins/horizontal-line'
import { LineToolHorizontalRay } from '@/widgets/widgets/data_chart/plugins/horizontal-ray'
import { LineToolLongShortPosition } from '@/widgets/widgets/data_chart/plugins/long-short-position'
import { LineToolMarketDepth } from '@/widgets/widgets/data_chart/plugins/market-depth'
import { LineToolParallelChannel } from '@/widgets/widgets/data_chart/plugins/parallel-channel'
import { LineToolPath } from '@/widgets/widgets/data_chart/plugins/path'
import { LineToolPriceRange } from '@/widgets/widgets/data_chart/plugins/price-range'
import { LineToolRay } from '@/widgets/widgets/data_chart/plugins/ray'
import { LineToolRectangle } from '@/widgets/widgets/data_chart/plugins/rectangle'
import { LineToolText } from '@/widgets/widgets/data_chart/plugins/text'
import { LineToolTrendLine } from '@/widgets/widgets/data_chart/plugins/trend-line'
import { LineToolTriangle } from '@/widgets/widgets/data_chart/plugins/triangle'
import { LineToolVerticalLine } from '@/widgets/widgets/data_chart/plugins/vertical-line'

export const TEXT_EDITABLE_TOOL_TYPES = new Set<ManualToolType>(['Text', 'Callout'])

export const registerAllManualTools = (plugin: ILineToolsPlugin) => {
  plugin.registerLineTool('TrendLine', LineToolTrendLine as any)
  plugin.registerLineTool('Ray', LineToolRay as any)
  plugin.registerLineTool('Arrow', LineToolArrow as any)
  plugin.registerLineTool('ExtendedLine', LineToolExtendedLine as any)
  plugin.registerLineTool('HorizontalLine', LineToolHorizontalLine as any)
  plugin.registerLineTool('HorizontalRay', LineToolHorizontalRay as any)
  plugin.registerLineTool('VerticalLine', LineToolVerticalLine as any)
  plugin.registerLineTool('CrossLine', LineToolCrossLine as any)
  plugin.registerLineTool('Callout', LineToolCallout as any)
  plugin.registerLineTool('Brush', LineToolBrush as any)
  plugin.registerLineTool('Highlighter', LineToolHighlighter as any)
  plugin.registerLineTool('Rectangle', LineToolRectangle as any)
  plugin.registerLineTool('Circle', LineToolCircle as any)
  plugin.registerLineTool('Triangle', LineToolTriangle as any)
  plugin.registerLineTool('Path', LineToolPath as any)
  plugin.registerLineTool('ParallelChannel', LineToolParallelChannel as any)
  plugin.registerLineTool('FibRetracement', LineToolFibRetracement as any)
  plugin.registerLineTool('PriceRange', LineToolPriceRange as any)
  plugin.registerLineTool('LongShortPosition', LineToolLongShortPosition as any)
  plugin.registerLineTool('Text', LineToolText as any)
  plugin.registerLineTool('MarketDepth', LineToolMarketDepth as any)
}
