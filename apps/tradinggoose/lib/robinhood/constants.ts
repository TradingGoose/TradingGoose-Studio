export const ROBINHOOD_PROVIDER_ID = 'robinhood'
export const ROBINHOOD_MCP_URL = 'https://agent.robinhood.com/mcp/trading'
export const ROBINHOOD_AUTHORIZATION_URL = 'https://robinhood.com/oauth'
export const ROBINHOOD_TOKEN_URL = 'https://api.robinhood.com/oauth2/token/'
export const ROBINHOOD_REGISTRATION_URL = 'https://agent.robinhood.com/oauth/trading/register'

export const getRobinhoodRedirectUri = (baseUrl: string) =>
  `${baseUrl}/api/auth/oauth2/callback/${ROBINHOOD_PROVIDER_ID}`
