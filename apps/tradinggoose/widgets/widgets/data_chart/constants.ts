import { getMarketProviderOptionsByKind } from '@/providers/market/providers'
import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'

export const providerOptions = getMarketProviderOptionsByKind('series')

export const EMPTY_INDICATORS: CustomIndicatorDefinition[] = []
