import { resolveIbkrApiIp } from '@/providers/trading/ibkr/config'

export const buildIbkrAuthHeaders = (params: { accessToken?: string }): Record<string, string> => {
  if (!params.accessToken) {
    throw new Error('IBKR access token is required')
  }

  return {
    Authorization: `Bearer ${params.accessToken}`,
    ip: resolveIbkrApiIp(),
  }
}
