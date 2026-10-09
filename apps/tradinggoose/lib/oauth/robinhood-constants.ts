export const ROBINHOOD_OAUTH_RESOURCE = 'https://agent.robinhood.com/mcp/trading'
const ROBINHOOD_OAUTH_CALLBACK_PATH = '/api/auth/oauth2/callback/robinhood'
export const ROBINHOOD_LOOPBACK_REDIRECT_URI = `http://127.0.0.1:43821${ROBINHOOD_OAUTH_CALLBACK_PATH}`

export function getRobinhoodOAuthRedirectUri(baseUrl: string, hosted: boolean) {
  return hosted
    ? ROBINHOOD_LOOPBACK_REDIRECT_URI
    : `${new URL(baseUrl).origin}${ROBINHOOD_OAUTH_CALLBACK_PATH}`
}
