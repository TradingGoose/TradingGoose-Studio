'use client'

import { List } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { WatchlistWidgetBody } from '@/widgets/widgets/watchlist/components/watchlist-body'
import {
  WatchlistHeaderCenterControls,
  WatchlistHeaderLeftControls,
  WatchlistHeaderRightControls,
} from '@/widgets/widgets/watchlist/components/watchlist-header-controls'

export const watchlistWidget: DashboardWidgetDefinition = {
  key: 'watchlist',
  title: 'Watchlist',
  icon: List,
  category: 'list',
  description: 'Manage symbol watchlists with live market columns.',
  component: (props) => <WatchlistWidgetBody {...props} />,
  renderHeader: ({ context, panelId, widget }) => ({
    left: (
      <WatchlistHeaderLeftControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
      />
    ),
    center: (
      <WatchlistHeaderCenterControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
      />
    ),
    right: (
      <WatchlistHeaderRightControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widget={widget}
      />
    ),
  }),
}
