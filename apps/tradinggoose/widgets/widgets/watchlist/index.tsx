'use client'

import { List } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { WatchlistWidgetBody } from '@/widgets/widgets/watchlist/components/watchlist-body'
import { renderWatchlistHeader } from '@/widgets/widgets/watchlist/components/watchlist-header-controls'
import { watchlistWidgetContract } from '@/widgets/widgets/watchlist/contract'

export const watchlistWidget: DashboardWidgetDefinition = {
  contract: watchlistWidgetContract,
  icon: List,
  component: (props) => <WatchlistWidgetBody {...props} />,
  renderHeader: renderWatchlistHeader,
}
