export const UNSUPPORTED_INDICATOR_FEATURES = [
  {
    id: 'request.security',
    summary:
      'Cross-symbol or cross-timeframe `request.security` calls are not supported in the TradingGoose PineTS runtime.',
  },
  {
    id: 'request.security_lower_tf',
    summary: '`request.security_lower_tf` is not supported in the TradingGoose PineTS runtime.',
  },
] as const

export const detectUnsupportedFeatures = (pineCode: string): string[] => {
  const code = pineCode ?? ''
  const features: string[] = []

  if (/\brequest\.security\b/.test(code)) {
    features.push(UNSUPPORTED_INDICATOR_FEATURES[0].id)
  }
  if (/\brequest\.security_lower_tf\b/.test(code)) {
    features.push(UNSUPPORTED_INDICATOR_FEATURES[1].id)
  }

  return features
}
