import { describe, expect, it } from 'vitest'
import {
  getTradingWidgetProviderOptions,
  resolveTradingWidgetProviderId,
} from '@/widgets/utils/trading-widget-providers'

describe('trading widget provider helpers', () => {
  it('filters provider options by availability and resolves invalid persisted providers', () => {
    const options = getTradingWidgetProviderOptions('holdings', {
      alpaca: true,
      tradier: false,
    })

    expect(options.map((option) => option.id)).toEqual(['alpaca'])
    expect(resolveTradingWidgetProviderId('tradier', options)).toBe('')
    expect(resolveTradingWidgetProviderId('alpaca', options)).toBe('alpaca')
  })
})
