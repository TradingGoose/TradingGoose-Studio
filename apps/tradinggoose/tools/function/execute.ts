import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import type { CodeExecutionInput, CodeExecutionOutput } from '@/tools/function/types'
import type { ToolConfig } from '@/tools/types'

export const functionExecuteTool: ToolConfig<CodeExecutionInput, CodeExecutionOutput> = {
  id: 'function_execute',
  name: 'Function Execute',
  description:
    'Execute TypeScript code. fetch() is available. Code runs in async IIFE wrapper automatically after TypeScript transpiles to JavaScript. CRITICAL: Write plain statements with await/return, NOT wrapped in functions. For built-in indicators, use indicator.<ID>(marketSeries) with full Historical Data output and an optional object of input-title overrides. Do not define indicator(...) or import pinets/PineTS in this block.',
  version: '1.0.0',

  params: {
    code: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Raw TypeScript statements (NOT a function). Code is transpiled to JavaScript and auto-wrapped in async context. MUST use fetch() for HTTP (NOT xhr/axios/request libs). Write like: await fetch(url) then return result. Imports require E2B runtime support. For built-in indicators, pass the full Historical Data MarketSeries object, not a scalar series like <historical_data.close>. The optional second argument must be an object, for example indicator.RSI(<historical_data>, { Length: 7 }) or indicator.RSI(<historical_data>, { inputs: { Length: 7 } }). Use indicator.list() if the built-in ID is unknown. Do not import pinets or define indicator(...) directly.',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'hidden',
      description: 'Execution timeout in milliseconds',
      default: DEFAULT_EXECUTION_TIMEOUT_MS,
    },
    envVars: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Environment variables to make available during execution',
      default: {},
    },
    blockData: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Block output data for variable resolution',
      default: {},
    },
    blockNameMapping: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Mapping of block names to block IDs',
      default: {},
    },
    blockOutputSchemas: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Mapping of block IDs to their output schemas for validation',
      default: {},
    },
    workflowVariables: {
      type: 'object',
      required: false,
      visibility: 'hidden',
      description: 'Workflow variables for <variable.name> resolution',
      default: {},
    },
  },

  request: {
    url: '/api/function/execute',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: CodeExecutionInput) => {
      const codeContent = Array.isArray(params.code)
        ? params.code.map((c: { content: string }) => c.content).join('\n')
        : params.code

      return {
        code: codeContent,
        timeout: params.timeout || DEFAULT_EXECUTION_TIMEOUT_MS,
        envVars: params.envVars || {},
        workflowVariables: params.workflowVariables || {},
        blockData: params.blockData || {},
        blockNameMapping: params.blockNameMapping || {},
        blockOutputSchemas: params.blockOutputSchemas || {},
        workflowId: params._context?.workflowId,
        userId: params._context?.userId,
        concurrencyLeaseInherited: params._context?.concurrencyLeaseInherited,
        ...(params._context?.workspaceId
          ? { workspaceId: params._context.workspaceId }
          : {}),
        isCustomTool: params.isCustomTool || false,
      }
    },
  },

  transformResponse: async (response: Response): Promise<CodeExecutionOutput> => {
    const result = await response.json()

    if (!result.success) {
      return {
        success: false,
        output: {
          result: null,
          stdout: result.output?.stdout || '',
        },
        error: result.error,
      }
    }

    return {
      success: true,
      output: {
        result: result.output.result,
        stdout: result.output.stdout,
      },
    }
  },

  outputs: {
    result: { type: 'string', description: 'The result of the code execution' },
    stdout: { type: 'string', description: 'The standard output of the code execution' },
  },
}
