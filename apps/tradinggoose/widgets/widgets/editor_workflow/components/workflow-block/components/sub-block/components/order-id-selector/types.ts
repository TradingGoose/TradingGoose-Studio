import type { SerializedOrderSearchOption } from '@/lib/trading/order-records'

export type OrderHistorySearchOption = SerializedOrderSearchOption

export const ORDER_ID_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const isOrderUuid = (value: string): boolean => ORDER_ID_UUID_PATTERN.test(value.trim())
