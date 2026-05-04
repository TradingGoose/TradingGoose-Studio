export const buildAlpacaAuthHeaders = (params: {
  accessToken?: string
}): Record<string, string> => {
  if (!params.accessToken) {
    throw new Error('Alpaca access token is required')
  }

  return { Authorization: `Bearer ${params.accessToken}` }
}
