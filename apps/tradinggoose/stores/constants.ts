export const API_ENDPOINTS = {
  ENVIRONMENT: '/api/environment',
  SCHEDULE: '/api/schedules',
  SETTINGS: '/api/settings',
  WORKFLOWS: '/api/workflows',
  WORKSPACE_PERMISSIONS: (id: string) => `/api/workspaces/${id}/permissions`,
  WORKSPACE_ENVIRONMENT: (id: string) => `/api/workspaces/${id}/environment`,
}
