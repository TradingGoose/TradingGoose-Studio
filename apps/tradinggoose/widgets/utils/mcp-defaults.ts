export const MCP_SERVER_DEFAULTS = {
  name: '',
  description: '',
  url: '',
  headers: {} as Record<string, string>,
  command: '',
  args: [] as string[],
  env: {} as Record<string, string>,
  timeout: 30000,
  retries: 3,
  enabled: true,
} as const
