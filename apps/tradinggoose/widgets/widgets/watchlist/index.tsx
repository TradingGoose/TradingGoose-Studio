'use client'

import { List } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { WatchlistWidgetBody } from '@/widgets/widgets/watchlist/components/watchlist-body'
import { renderWatchlistHeader } from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

export const watchlistWidget: DashboardWidgetDefinition = {
  key: 'watchlist',
  title: 'Watchlist',
  icon: List,
  category: 'list',
  description: 'Manage symbol watchlists with live market columns.',
  component: (props) => <WatchlistWidgetBody {...props} />,
  renderHeader: renderWatchlistHeader,
}
