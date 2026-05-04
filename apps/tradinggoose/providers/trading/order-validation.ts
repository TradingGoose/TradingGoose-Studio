export const ALPACA_NOTIONAL_ORDER_TYPE_ERROR =
  'Alpaca notional orders support market, limit, stop, or stop_limit types.'

export const ALPACA_TRAILING_STOP_TRAIL_VALUE_ERROR = 'Enter either trail price or trail percent.'

const ALPACA_NOTIONAL_ORDER_TYPES = new Set(['market', 'limit', 'stop', 'stop_limit'])

const normalizeOrderType = (orderType?: string | null) => {
  const normalized = orderType?.trim().toLowerCase()
  return normalized || 'market'
}

export function getAlpacaNotionalOrderTypeError(orderType?: string | null): string | null {
  return ALPACA_NOTIONAL_ORDER_TYPES.has(normalizeOrderType(orderType))
    ? null
    : ALPACA_NOTIONAL_ORDER_TYPE_ERROR
}
