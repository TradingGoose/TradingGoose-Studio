import type { ComponentType, ReactNode } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetCategory, WidgetContract, WidgetKey } from '@/widgets/widget-contract-types'

export type WidgetRuntimeContext = {
  workspaceId?: string
  dashboardLayoutId?: string
  dashboardLayoutName?: string
  dashboardLayoutOwnerUserId?: string
}

export type { WidgetCategory }

export interface WidgetCategoryDefinition {
  key: WidgetCategory
  title: string
  description?: string
}

export interface WidgetComponentProps {
  channelId: string
  params?: Record<string, unknown> | null
  context?: WidgetRuntimeContext
  pairColor?: PairColor
  panelId?: string
  widget?: WidgetInstance | null
  onWidgetChange?: (widgetKey: string) => void
  onWidgetParamsPatch?: (params: Record<string, unknown>) => void
  onWidgetLinkedParamsPatch?: (params: Record<string, unknown>) => void
}

export type DashboardWidgetComponent = (props: WidgetComponentProps) => ReactNode

export type WidgetHeaderSlots = {
  left?: ReactNode | ReactNode[]
  center?: ReactNode | ReactNode[]
  right?: ReactNode | ReactNode[]
}

export interface WidgetHeaderContext {
  channelId: string
  widget: WidgetInstance
  context?: WidgetRuntimeContext
  panelId?: string
  canEditWidgetParams?: boolean
}

export type WidgetHeaderRenderer = (options: WidgetHeaderContext) => WidgetHeaderSlots | undefined

export interface DashboardWidgetDefinition {
  contract: WidgetContract
  icon: ComponentType<{ className?: string }>
  component: DashboardWidgetComponent
  renderHeader?: WidgetHeaderRenderer
}

export interface EmptyDashboardWidgetDefinition {
  key: 'empty'
  icon: ComponentType<{ className?: string }>
  component: DashboardWidgetComponent
  renderHeader?: WidgetHeaderRenderer
}

export interface DashboardWidgetMetadata {
  title: string
  category: WidgetCategory
  description: string
}

export type DashboardWidgetRegistryDefinition =
  | DashboardWidgetDefinition
  | EmptyDashboardWidgetDefinition

export type DashboardWidgetCatalogDefinition = {
  key: WidgetKey | 'empty'
  icon: ComponentType<{ className?: string }>
  component: DashboardWidgetComponent
  renderHeader?: WidgetHeaderRenderer
} & DashboardWidgetMetadata

export interface WidgetCategoryGroup extends WidgetCategoryDefinition {
  widgets: DashboardWidgetCatalogDefinition[]
}
