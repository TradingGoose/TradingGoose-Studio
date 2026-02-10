'use client'

export const LINES_FAMILY_TOOL_TYPES = [
  'TrendLine',
  'Ray',
  'Arrow',
  'ExtendedLine',
  'HorizontalLine',
  'HorizontalRay',
  'VerticalLine',
  'CrossLine',
  'Callout',
] as const

export const FREEHAND_FAMILY_TOOL_TYPES = ['Brush', 'Highlighter'] as const

export const SINGLE_TOOL_TYPES = [
  'Rectangle',
  'Circle',
  'Triangle',
  'Path',
  'ParallelChannel',
  'FibRetracement',
  'PriceRange',
  'LongShortPosition',
  'Text',
  'MarketDepth',
] as const

export const MANUAL_TOOL_TYPES = [
  ...LINES_FAMILY_TOOL_TYPES,
  ...FREEHAND_FAMILY_TOOL_TYPES,
  ...SINGLE_TOOL_TYPES,
] as const

export type ManualToolType = (typeof MANUAL_TOOL_TYPES)[number]
