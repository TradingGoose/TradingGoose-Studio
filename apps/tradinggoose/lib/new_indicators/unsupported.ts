export const detectUnsupportedFeatures = (pineCode: string): string[] => {
  const code = pineCode ?? ''
  const features: string[] = []

  if (/\brequest\.security\b/.test(code)) {
    features.push('request.security')
  }
  if (/\brequest\.security_lower_tf\b/.test(code)) {
    features.push('request.security_lower_tf')
  }

  return features
}

