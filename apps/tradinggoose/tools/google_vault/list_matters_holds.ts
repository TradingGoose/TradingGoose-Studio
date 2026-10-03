import type { GoogleVaultListMattersHoldsParams } from '@/tools/google_vault/types'
import type { ToolConfig } from '@/tools/types'

export const listMattersHoldsTool: ToolConfig<GoogleVaultListMattersHoldsParams> = {
  id: 'list_matters_holds',
  name: 'Vault List Holds (by Matter)',
  description: 'List holds for a matter',
  version: '1.0',

  oauth: {
    required: true,
    provider: 'google-vault',
    additionalScopes: ['https://www.googleapis.com/auth/ediscovery'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Google Vault',
    },
    matterId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ID of the Vault matter whose holds will be read',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of holds to return',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Token for the next page of holds',
    },
    holdId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Optional hold ID to retrieve instead of listing holds',
    },
  },

  request: {
    url: (params) => {
      if (params.holdId) {
        return `https://vault.googleapis.com/v1/matters/${params.matterId}/holds/${params.holdId}`
      }
      const url = new URL(`https://vault.googleapis.com/v1/matters/${params.matterId}/holds`)
      // Handle pageSize - convert to number if needed
      if (params.pageSize !== undefined && params.pageSize !== null) {
        const pageSize = Number(params.pageSize)
        if (Number.isFinite(pageSize) && pageSize > 0) {
          url.searchParams.set('pageSize', String(pageSize))
        }
      }
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      // Default BASIC_HOLD implicitly by omitting 'view'
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.accessToken}` }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to list holds')
    }
    return { success: true, output: data }
  },
}
