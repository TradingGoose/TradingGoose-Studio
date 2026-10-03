import { getBaseUrl } from '@/lib/urls/utils'

export function workflowPauseLinks(workflowId: string, executionId: string) {
  const path = `${encodeURIComponent(workflowId)}/${encodeURIComponent(executionId)}`
  return {
    url: `${getBaseUrl()}/resume/${path}`,
    resumeEndpoint: `${getBaseUrl()}/api/resume/${path}`,
  }
}
