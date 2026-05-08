import type { ConfigMonitorViewConfig } from '../view/view-config'
import type { ConfigMonitorCard } from './config-card-model'
import { cardMatchesConfigFilters, parseConfigQuery } from './config-query'

export const filterConfigMonitorCards = (
  cards: ConfigMonitorCard[],
  config: ConfigMonitorViewConfig
) => {
  const parsed = parseConfigQuery(config.filterQuery)
  const filters = parsed.filters.concat(config.quickFilters)

  return cards.filter((card) => cardMatchesConfigFilters(card, filters, parsed.textSearch))
}
