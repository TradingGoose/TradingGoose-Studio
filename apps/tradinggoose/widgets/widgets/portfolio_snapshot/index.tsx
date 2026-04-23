'use client'

import { Wallet } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { PortfolioSnapshotWidgetBody } from '@/widgets/widgets/portfolio_snapshot/components/body'
import { renderPortfolioSnapshotHeader } from '@/widgets/widgets/portfolio_snapshot/components/header'

export const portfolioSnapshotWidget: DashboardWidgetDefinition = {
  key: 'portfolio_snapshot',
  title: 'Portfolio Snapshot',
  icon: Wallet,
  category: 'utility',
  description: 'Broker account performance and current account summary.',
  component: (props) => <PortfolioSnapshotWidgetBody {...props} />,
  renderHeader: renderPortfolioSnapshotHeader,
}
