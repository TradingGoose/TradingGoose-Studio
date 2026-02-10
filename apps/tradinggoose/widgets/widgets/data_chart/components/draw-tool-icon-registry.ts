'use client'

import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  ArrowUpDown,
  Brush,
  Circle,
  Columns3,
  Crosshair,
  Eraser,
  Eye,
  EyeOff,
  Highlighter,
  MessageSquareText,
  Minus,
  MoveHorizontal,
  MoveRight,
  MoveVertical,
  PencilLine,
  Ruler,
  Sigma,
  Square,
  Triangle,
  Trash2,
  TrendingUp,
  Type,
} from 'lucide-react'
import {
  FREEHAND_FAMILY_TOOL_TYPES,
  LINES_FAMILY_TOOL_TYPES,
  SINGLE_TOOL_TYPES,
  type ManualToolType,
} from '@/widgets/widgets/data_chart/drawings/manual-tool-types'

export type DrawToolActionType =
  | 'clearAll'
  | 'hideAll'
  | 'showAll'
  | 'hideSelected'
  | 'removeSelected'

export const DRAW_TOOL_LABELS: Record<ManualToolType, string> = {
  TrendLine: 'Trend line',
  Ray: 'Ray',
  Arrow: 'Arrow',
  ExtendedLine: 'Extended line',
  HorizontalLine: 'Horizontal line',
  HorizontalRay: 'Horizontal ray',
  VerticalLine: 'Vertical line',
  CrossLine: 'Cross line',
  Callout: 'Callout',
  Brush: 'Brush',
  Highlighter: 'Highlighter',
  Rectangle: 'Rectangle',
  Circle: 'Circle',
  Triangle: 'Triangle',
  Path: 'Path',
  ParallelChannel: 'Parallel channel',
  FibRetracement: 'Fib retracement',
  PriceRange: 'Price range',
  LongShortPosition: 'Long/short position',
  Text: 'Text',
  MarketDepth: 'Market depth',
}

export const DRAW_ACTION_LABELS: Record<DrawToolActionType, string> = {
  clearAll: 'Clear all',
  hideAll: 'Hide all',
  showAll: 'Show all',
  hideSelected: 'Hide selected',
  removeSelected: 'Remove selected',
}

export const DRAW_TOOL_ICONS: Record<ManualToolType, LucideIcon> = {
  TrendLine: TrendingUp,
  Ray: MoveRight,
  Arrow: MoveRight,
  ExtendedLine: MoveHorizontal,
  HorizontalLine: Minus,
  HorizontalRay: MoveRight,
  VerticalLine: MoveVertical,
  CrossLine: Crosshair,
  Callout: MessageSquareText,
  Brush,
  Highlighter,
  Rectangle: Square,
  Circle,
  Triangle,
  Path: PencilLine,
  ParallelChannel: Columns3,
  FibRetracement: Sigma,
  PriceRange: Ruler,
  LongShortPosition: ArrowUpDown,
  Text: Type,
  MarketDepth: ArrowLeftRight,
}

export const DRAW_ACTION_ICONS: Record<DrawToolActionType, LucideIcon> = {
  clearAll: Eraser,
  hideAll: EyeOff,
  showAll: Eye,
  hideSelected: EyeOff,
  removeSelected: Trash2,
}

export const DRAW_TOOL_FAMILY_GROUPS = {
  lines: [...LINES_FAMILY_TOOL_TYPES],
  freehand: [...FREEHAND_FAMILY_TOOL_TYPES],
  singles: [...SINGLE_TOOL_TYPES],
} as const
