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
] as const

export const NOTES_FAMILY_TOOL_TYPES = ['Callout', 'Text'] as const

export const FREEHAND_FAMILY_TOOL_TYPES = ['Brush', 'Highlighter', 'Path'] as const

export const SHAPES_FAMILY_TOOL_TYPES = ['Rectangle', 'Circle', 'Triangle'] as const

export const SINGLE_TOOL_TYPES = [
  'ParallelChannel',
  'FibRetracement',
  'PriceRange',
  'LongShortPosition',
  'MarketDepth',
] as const

export const MANUAL_TOOL_TYPES = [
  ...LINES_FAMILY_TOOL_TYPES,
  ...NOTES_FAMILY_TOOL_TYPES,
  ...FREEHAND_FAMILY_TOOL_TYPES,
  ...SHAPES_FAMILY_TOOL_TYPES,
  ...SINGLE_TOOL_TYPES,
] as const

export type ManualToolType = (typeof MANUAL_TOOL_TYPES)[number]
