import { Send } from 'lucide-react'
import { quickOrderWidgetContract } from '@/widgets/widgets/quick_order/contract'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { QuickOrderWidgetBody } from '@/widgets/widgets/quick_order/components/body'
import { renderQuickOrderHeader } from '@/widgets/widgets/quick_order/components/header'

export const quickOrderWidget: DashboardWidgetDefinition = {
  contract: quickOrderWidgetContract,
  icon: Send,
  component: QuickOrderWidgetBody,
  renderHeader: renderQuickOrderHeader,
}
