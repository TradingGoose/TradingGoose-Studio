import type {
  JiraCloudResource,
  JiraRetrieveBulkParams,
  JiraRetrieveResponseBulk,
} from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

export const jiraBulkRetrieveTool: ToolConfig<JiraRetrieveBulkParams, JiraRetrieveResponseBulk> = {
  id: 'jira_bulk_read',
  name: 'Jira Bulk Read',
  description: 'Retrieve multiple Jira issues in bulk',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: ['read:jira-work', 'read:jira-user', 'read:me', 'offline_access'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jira project ID',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Jira cloud ID',
    },
  },

  request: {
    url: 'https://api.atlassian.com/oauth/token/accessible-resources',
    method: 'GET',
    headers: (params: JiraRetrieveBulkParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: JiraRetrieveBulkParams) => {
    if (!params?.projectId.trim()) throw new Error('Project ID is required.')
    const MAX_TOTAL = 1000
    const PAGE_SIZE = 100

    // Helper to extract description text safely (ADF can be nested)
    const extractDescription = (desc: any): string => {
      try {
        return (
          desc?.content?.[0]?.content?.[0]?.text ||
          desc?.content?.flatMap((c: any) => c?.content || [])?.find((c: any) => c?.text)?.text ||
          ''
        )
      } catch (_e) {
        return ''
      }
    }

    let cloudId = params.cloudId
    if (!cloudId) {
      const resources: JiraCloudResource[] = await response.json()
      const domain = `https://${params.domain}`.toLowerCase()
      cloudId = resources.find((resource) => resource.url.toLowerCase() === domain)?.id
      if (!cloudId) throw new Error(`No Jira resource found for ${params.domain}`)
    }

    const queryParams = new URLSearchParams({
      jql: `project = ${JSON.stringify(params.projectId.trim())} ORDER BY updated DESC`,
      fields: 'summary,description,created,updated',
      maxResults: String(PAGE_SIZE),
    })
    const collected: any[] = []
    while (collected.length < MAX_TOTAL) {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${queryParams.toString()}`
      const pageResponse = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
        },
      })
      if (!pageResponse.ok) throw new Error(`Failed to fetch Jira issues (${pageResponse.status})`)
      const pageData = await pageResponse.json()
      collected.push(...pageData.issues)
      if (pageData.isLast || !pageData.nextPageToken) break
      queryParams.set('nextPageToken', pageData.nextPageToken)
    }

    return {
      success: true,
      output: {
        issues: collected.slice(0, MAX_TOTAL).map((issue: any) => ({
          ts: new Date().toISOString(),
          summary: issue.fields?.summary,
          description: extractDescription(issue.fields?.description),
          created: issue.fields?.created,
          updated: issue.fields?.updated,
        })),
      },
    }
  },

  outputs: {
    issues: {
      type: 'array',
      description: 'Array of Jira issues with summary, description, created and updated timestamps',
    },
  },
}
