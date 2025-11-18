import type { ComponentType, ReactNode } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'

export type WidgetRuntimeContext = {
  workspaceId?: string
}

export type WidgetCategory = 'editor' | 'list' | 'utility'

export interface WidgetCategoryDefinition {
  key: WidgetCategory
  title: string
  description?: string
}

export interface WidgetComponentProps {
  params?: Record<string, unknown> | null
  context?: WidgetRuntimeContext
  pairColor?: PairColor
  panelId?: string
  widget?: WidgetInstance | null
  onWidgetChange?: (widgetKey: string) => void
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
}

export type DashboardWidgetComponent = (props: WidgetComponentProps) => ReactNode

export type WidgetHeaderSlots = {
  left?: ReactNode | ReactNode[]
  center?: ReactNode | ReactNode[]
  right?: ReactNode | ReactNode[]
}

export interface WidgetHeaderContext {
  widget: WidgetInstance
  context?: WidgetRuntimeContext
  panelId?: string
}

export type WidgetHeaderRenderer = (options: WidgetHeaderContext) => WidgetHeaderSlots | void

export interface DashboardWidgetDefinition {
  key: string
  title: string
  icon: ComponentType<{ className?: string }>
  category: WidgetCategory
  description: string
  component: DashboardWidgetComponent
  renderHeader?: WidgetHeaderRenderer
}

export interface WidgetCategoryGroup extends WidgetCategoryDefinition {
  widgets: DashboardWidgetDefinition[]
}
