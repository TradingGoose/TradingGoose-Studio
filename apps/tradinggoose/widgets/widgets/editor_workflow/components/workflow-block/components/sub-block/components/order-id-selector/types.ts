export interface OrderHistorySearchOption {
  id: string
  provider: string
  environment: string | null
  side: string | null
  quantity: number | null
  notional: number | null
  placedAt: string | null
  recordedAt: string
  symbol: string | null
  quote: string | null
  companyName: string | null
  iconUrl: string | null
  assetClass: string | null
  listingType: string | null
}

export const ORDER_ID_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isOrderUuid = (value: string): boolean => ORDER_ID_UUID_PATTERN.test(value.trim())
