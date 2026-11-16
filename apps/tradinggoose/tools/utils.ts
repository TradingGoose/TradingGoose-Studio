import { tools } from '@/tools/registry'
import type { TableRow, ToolConfig } from '@/tools/types'

/**
 * Transforms a table from the store format to a key-value object
 * @param table Array of table rows from the store
 * @returns Record of key-value pairs
 */
export const transformTable = (table: TableRow[] | null): Record<string, any> => {
  if (!table) return {}

  return table.reduce(
    (acc, row) => {
      if (row.cells?.Key && row.cells?.Value !== undefined) {
        // Extract the Value cell as is - it should already be properly resolved
        // by the InputResolver based on variable type (number, string, boolean etc.)
        const value = row.cells.Value

        // Store the correctly typed value in the result object
        acc[row.cells.Key] = value
      }
      return acc
    },
    {} as Record<string, any>
  )
}

interface RequestParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string | FormData
  timeout?: number
}

/**
 * Format request parameters based on tool configuration and provided params
 */
export async function formatRequestParams(
  tool: ToolConfig,
  params: Record<string, any>
): Promise<RequestParams> {
  // Process URL
  const url = typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

  // Process method
  const method =
    typeof tool.request.method === 'function' ? tool.request.method(params) : tool.request.method

  // Process headers
  const headers = tool.request.headers ? tool.request.headers(params) : {}

  // Process body
  const hasBody = method !== 'GET' && method !== 'HEAD' && !!tool.request.body
  const bodyResult = await tool.request.body?.(params)

  // Special handling for NDJSON content type or 'application/x-www-form-urlencoded'
  const isPreformattedContent =
    headers['Content-Type'] === 'application/x-ndjson' ||
    headers['Content-Type'] === 'application/x-www-form-urlencoded'
  let body: string | FormData | undefined
  if (hasBody) {
    if (typeof FormData !== 'undefined' && bodyResult instanceof FormData) {
      body = bodyResult
    } else {
      if (isPreformattedContent) {
        if (typeof bodyResult === 'string') {
          body = bodyResult
        } else if (bodyResult && typeof bodyResult === 'object' && 'body' in bodyResult) {
          body = (bodyResult as { body: string }).body
        } else {
          body = JSON.stringify(bodyResult)
        }
      } else {
        body = typeof bodyResult === 'string' ? bodyResult : JSON.stringify(bodyResult)
      }
    }
  }

  const MAX_TIMEOUT_MS = 600000
  const rawTimeout = params.timeout
  const timeout = rawTimeout != null ? Number(rawTimeout) : undefined
  const validTimeout =
    timeout != null && Number.isFinite(timeout) && timeout > 0
      ? Math.min(timeout, MAX_TIMEOUT_MS)
      : undefined

  return { url, method, headers, body, timeout: validTimeout }
}

/**
 * Formats a parameter name for user-friendly error messages
 * Converts parameter names and descriptions to more readable format
 */
function formatParameterNameForError(paramName: string): string {
  // Split camelCase and snake_case/kebab-case into words, then capitalize first letter of each word
  return paramName
    .split(/(?=[A-Z])|[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Validates required parameters after LLM and user params have been merged
 * This is the final validation before tool execution - ensures all required
 * user-or-llm parameters are present after the merge process
 */
export function validateRequiredParametersAfterMerge(
  toolId: string,
  tool: ToolConfig | undefined,
  params: Record<string, any>
): void {
  if (!tool) {
    throw new Error(`Tool not found: ${toolId}`)
  }

  // Validate all required user-or-llm parameters after merge
  // user-only parameters should have been validated earlier during serialization
  for (const [paramName, paramConfig] of Object.entries(tool.params)) {
    if (
      paramConfig.visibility === 'user-or-llm' &&
      paramConfig.required &&
      (!(paramName in params) ||
        params[paramName] === null ||
        params[paramName] === undefined ||
        params[paramName] === '')
    ) {
      // Create a more user-friendly error message
      const toolName = tool.name || toolId
      const friendlyParamName = formatParameterNameForError(paramName)
      throw new Error(`"${friendlyParamName}" is required for ${toolName}`)
    }
  }
}

/**
 * Creates parameter schema from custom tool schema
 */
export function createParamSchema(customTool: any): Record<string, any> {
  const params: Record<string, any> = {}

  if (customTool.schema.function?.parameters?.properties) {
    const properties = customTool.schema.function.parameters.properties
    const required = customTool.schema.function.parameters.required || []

    Object.entries(properties).forEach(([key, config]: [string, any]) => {
      const isRequired = required.includes(key)

      // Create the base parameter configuration
      const paramConfig: Record<string, any> = {
        type: config.type || 'string',
        required: isRequired,
        description: config.description || '',
      }

      // Set visibility based on whether it's required
      if (isRequired) {
        paramConfig.visibility = 'user-or-llm'
      } else {
        paramConfig.visibility = 'user-only'
      }

      params[key] = paramConfig
    })
  }

  return params
}

/** Creates a custom tool request from its definition and explicit execution context. */
export function createCustomToolRequestBody(customTool: any) {
  return (params: Record<string, any>) => {
    const context =
      params._context && typeof params._context === 'object'
        ? (params._context as Record<string, unknown>)
        : {}
    const envVars = params.envVars || {}

    // Get workflow variables from params (passed from execution context)
    const workflowVariables = params.workflowVariables || {}

    // Get block data and mapping from params (passed from execution context)
    const blockData = params.blockData || {}
    const blockNameMapping = params.blockNameMapping || {}
    const scopedWorkflowId =
      typeof context.workflowId === 'string' && context.workflowId ? context.workflowId : ''
    const scopedWorkspaceId =
      typeof context.workspaceId === 'string' && context.workspaceId ? context.workspaceId : ''

    // Include everything needed for execution
    return {
      code: customTool.code,
      params: params, // These will be available in the VM context
      schema: customTool.schema.function.parameters, // For validation
      envVars: envVars, // Environment variables
      workflowVariables: workflowVariables, // Workflow variables for <variable.name> resolution
      blockData: blockData, // Runtime block outputs for <block.field> resolution
      blockNameMapping: blockNameMapping, // Block name to ID mapping
      userId: context.userId, // Pass userId for auth context
      ...(scopedWorkflowId
        ? { workflowId: scopedWorkflowId }
        : scopedWorkspaceId
          ? { workspaceId: scopedWorkspaceId }
          : {}),
      ...(typeof context.workflowLogId === 'string' && context.workflowLogId
        ? { workflowLogId: context.workflowLogId }
        : {}),
      ...(typeof context.submissionSource === 'string' && context.submissionSource
        ? { submissionSource: context.submissionSource }
        : {}),
      ...(typeof context.isDeployedContext === 'boolean'
        ? { isDeployedContext: context.isDeployedContext }
        : {}),
      isCustomTool: true, // Flag to indicate this is a custom tool execution
    }
  }
}

// Get a tool by its ID
export function getTool(toolId: string): ToolConfig | undefined {
  return tools[toolId]
}

// Helper function to create a tool config from a custom tool
export function createToolConfig(customTool: any, customToolId: string): ToolConfig {
  // Create a parameter schema from the custom tool schema
  const params = createParamSchema(customTool)

  // Create a tool config for the custom tool
  return {
    id: customToolId,
    name: customTool.title,
    description: customTool.schema.function?.description || '',
    version: '1.0.0',
    params,
    inputSchema: customTool.schema.function.parameters,

    // Request configuration - for custom tools we'll use the execute endpoint
    request: {
      url: '/api/function/execute',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: createCustomToolRequestBody(customTool),
    },

    // Standard response handling for custom tools
    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Custom tool execution failed')
      }

      return {
        success: true,
        output: data.output.result,
        error: undefined,
      }
    },
  }
}
