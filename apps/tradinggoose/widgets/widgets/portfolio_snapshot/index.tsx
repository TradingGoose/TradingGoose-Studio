'use client'

import { Wallet } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { PortfolioSnapshotWidgetBody } from '@/widgets/widgets/portfolio_snapshot/components/body'
import { renderPortfolioSnapshotHeader } from '@/widgets/widgets/portfolio_snapshot/components/header'
import { portfolioSnapshotWidgetContract } from '@/widgets/widgets/portfolio_snapshot/contract'

export const portfolioSnapshotWidget: DashboardWidgetDefinition = {
  contract: portfolioSnapshotWidgetContract,
  icon: Wallet,
  component: (props) => <PortfolioSnapshotWidgetBody {...props} />,
  renderHeader: renderPortfolioSnapshotHeader,
}
