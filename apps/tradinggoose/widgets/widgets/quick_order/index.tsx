import { Send } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { QuickOrderWidgetBody } from '@/widgets/widgets/quick_order/components/body'
import { renderQuickOrderHeader } from '@/widgets/widgets/quick_order/components/header'

export const quickOrderWidget: DashboardWidgetDefinition = {
  key: 'quick_order',
  title: 'Quick Order',
  icon: Send,
  category: 'utility',
  description: 'Manual broker order entry for the selected trading account.',
  component: QuickOrderWidgetBody,
  renderHeader: renderQuickOrderHeader,
}
