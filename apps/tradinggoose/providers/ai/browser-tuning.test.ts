import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { ProviderRouteBody } from '@/app/api/providers/ai/handler'
import { GET as discoverServerModels } from '@/app/api/providers/ai/openrouter/models/route'
import { POST as executeHttpProvider } from '@/app/api/providers/route'
import { AgentBlock } from '@/blocks/blocks/agent'
import { getBlock } from '@/blocks/index'
import { Executor } from '@/executor'
import { getProviderModels, PROVIDER_DEFINITIONS } from '@/providers/ai/models'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mocks = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.chat } }
  },
}))
vi.mock('@/lib/cache/server-json-cache', () => ({
  readServerJsonCache: async () => null,
  writeServerJsonCache: async () => {},
}))
vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: vi.fn(),
  credentialAuthStatus: vi.fn(),
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: vi.fn() }))

const model = 'openrouter/publisher/reasoner'
const originalModels = PROVIDER_DEFINITIONS.openrouter.models
const browserWindow = {}

/** Builds a real browser Agent after an upstream trigger providing reference inputs. */
function browserWorkflow(params: Record<string, unknown>): SerializedWorkflow {
  const agent: SerializedBlock = {
    id: 'agent',
    metadata: { id: 'agent', name: 'Agent' },
    position: { x: 0, y: 0 },
    config: {
      tool: 'agent',
      params: { model, apiKey: 'test-key', userPrompt: 'Analyze', ...params },
    },
    inputs: {},
    outputs: {},
    enabled: true,
  }
  return {
    version: '1.0',
    blocks: [
      {
        ...agent,
        id: 'start',
        metadata: { id: 'input_trigger', name: 'Start', category: 'triggers' },
        config: { tool: 'input_trigger', params: { model, temperature: 0 } },
      },
      agent,
    ],
    connections: [{ source: 'start', target: 'agent' }],
    loops: {},
  }
}

/** Keeps separate client/server catalogs while real HTTP handlers perform discovery and inference. */
function browserTransport(catalog: 'supported' | 'unsupported' | 'unavailable' | 'omitted') {
  let serverModels: typeof originalModels = []
  let clientDiscoveryAttempts = 0
  let serverDiscoveryAttempts = 0
  const requests: Array<{ body: ProviderRouteBody; clientModels: string[] }> = []

  /** Installs only server state for the HTTP call, restoring client state before returning its response. */
  const onServer = async (run: () => Promise<Response>): Promise<Response> => {
    const clientModels = PROVIDER_DEFINITIONS.openrouter.models
    PROVIDER_DEFINITIONS.openrouter.models = serverModels
    vi.stubGlobal('window', undefined)
    try {
      return await run()
    } finally {
      serverModels = PROVIDER_DEFINITIONS.openrouter.models
      PROVIDER_DEFINITIONS.openrouter.models = clientModels
      vi.stubGlobal('window', browserWindow)
    }
  }

  vi.mocked(fetch).mockImplementation(
    /** Routes browser requests through real HTTP handlers with isolated server catalog state. */
    async (input, init) => {
      const url = new URL(String(input), 'http://localhost:3000')
      if (url.origin === 'https://openrouter.ai') {
        if (typeof window !== 'undefined') {
          clientDiscoveryAttempts++
          throw new Error('Browser catalog unavailable')
        }
        serverDiscoveryAttempts++
        if (catalog === 'unavailable') throw new Error('Server catalog unavailable')
        return Response.json({
          data:
            catalog === 'omitted'
              ? []
              : [
                  {
                    id: 'publisher/reasoner',
                    supported_parameters:
                      catalog === 'supported' ? ['temperature', 'verbosity'] : ['temperature'],
                    reasoning: { supported_efforts: catalog === 'supported' ? ['high'] : [] },
                    pricing: { prompt: '0.000002', completion: '0.000004' },
                  },
                ],
        })
      }
      if (url.pathname === '/api/providers/ai/openrouter/models') {
        clientDiscoveryAttempts++
        if (clientDiscoveryAttempts === 1) {
          return Response.json({ error: 'Browser catalog unavailable' }, { status: 502 })
        }
        return onServer(discoverServerModels)
      }
      if (url.pathname === '/api/providers') {
        const body = JSON.parse(String(init?.body)) as ProviderRouteBody
        requests.push({
          body: structuredClone(body),
          clientModels: getProviderModels('openrouter'),
        })
        return onServer(() =>
          executeHttpProvider(
            new NextRequest(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            })
          )
        )
      }
      throw new Error(`Unexpected browser request: ${url.pathname}`)
    }
  )
  return {
    requests,
    clientDiscoveryAttempts: () => clientDiscoveryAttempts,
    serverDiscoveryAttempts: () => serverDiscoveryAttempts,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('window', browserWindow)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
  PROVIDER_DEFINITIONS.openrouter.models = []
  vi.mocked(getBlock).mockImplementation((type) => (type === 'agent' ? AgentBlock : undefined))
  mocks.chat.mockImplementation(
    /** Returns the native response mode requested by the actual OpenRouter adapter. */
    async (payload) =>
      payload.stream
        ? (async function* () {
            yield { choices: [{ delta: { content: 'Done' } }] }
            yield {
              choices: [],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            }
          })()
        : {
            choices: [{ message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  PROVIDER_DEFINITIONS.openrouter.models = originalModels
})

it.each([
  { source: 'literal', stream: false, supported: true },
  { source: 'references', stream: false, supported: true },
  { source: 'references', stream: true, supported: true },
  { source: 'references', stream: false, supported: false },
])(
  'preserves browser tuning through real HTTP discovery: $source, stream=$stream, supported=$supported',
  async ({ source, stream, supported }) => {
    const transport = browserTransport(supported ? 'supported' : 'unsupported')
    const workflow = browserWorkflow({
      model: source === 'references' ? '<variable.model>' : model,
      temperature: source === 'references' ? '<start.temperature>' : 0,
      reasoningEffort: supported
        ? source === 'references'
          ? '<variable.effort>'
          : 'high'
        : '{{REMOVED}}',
      verbosity: supported ? (source === 'references' ? '{{VERBOSITY}}' : 'high') : '{{REMOVED}}',
      thinkingLevel: '{{REMOVED}}',
    })
    const savedParams = structuredClone(workflow.blocks[1].config.params)
    const result = await new Executor({
      workflow,
      workflowInput: { model, temperature: 0 },
      envVarValues: { VERBOSITY: 'high' },
      workflowVariables: {
        model: { name: 'model', type: 'plain', value: model },
        effort: { name: 'effort', type: 'plain', value: 'high' },
      },
      contextExtensions: { workspaceId: 'workspace', stream, selectedOutputs: ['agent'] },
    }).execute('workflow', 'start')

    expect(result.success, result.error).toBe(true)
    expect(transport.requests).toHaveLength(1)
    expect(transport.requests[0].body).toMatchObject({ model })
    expect(transport.requests[0].body.temperature).toBe(source === 'references' ? '0' : 0)
    expect(transport.requests[0].body.reasoningEffort).toBe(supported ? 'high' : undefined)
    expect(transport.requests[0].body.verbosity).toBe(supported ? 'high' : undefined)
    expect(transport.requests[0].body.thinkingLevel).toBeUndefined()
    expect(mocks.chat).toHaveBeenCalledTimes(1)
    expect(mocks.chat.mock.calls[0][0]).toMatchObject({
      model: 'publisher/reasoner',
      temperature: 0,
    })
    expect(mocks.chat.mock.calls[0][0].reasoning_effort).toBe(supported ? 'high' : undefined)
    expect(mocks.chat.mock.calls[0][0].verbosity).toBe(supported ? 'high' : undefined)
    expect(transport.clientDiscoveryAttempts()).toBeGreaterThan(0)
    expect(transport.serverDiscoveryAttempts()).toBeGreaterThan(0)
    expect(workflow.blocks[1].config.params).toEqual(savedParams)
  }
)

it.each([
  ...(['unavailable', 'omitted'] as const).flatMap((catalog) =>
    [
      {
        label: 'variable Auto, environment empty, upstream unset',
        effort: 'auto',
        verbosity: '',
        thinking: undefined,
      },
      {
        label: 'variable unset, environment Auto, upstream empty',
        effort: undefined,
        verbosity: 'auto',
        thinking: '',
      },
      {
        label: 'variable empty, environment empty, upstream Auto',
        effort: '',
        verbosity: '',
        thinking: 'auto',
      },
    ].map((values) => ({ catalog, ...values, zero: false, succeeds: true }))
  ),
  {
    catalog: 'unavailable',
    label: 'resolved actual effort',
    effort: 'high',
    verbosity: '',
    thinking: '',
    zero: false,
    succeeds: false,
  },
  {
    catalog: 'omitted',
    label: 'resolved zero temperature',
    effort: 'auto',
    verbosity: '',
    thinking: '',
    zero: true,
    succeeds: false,
  },
] as const)(
  'resolves browser unknown-capability reference intent: $catalog, $label',
  async ({ catalog, effort, verbosity, thinking, zero, succeeds }) => {
    const transport = browserTransport(catalog)
    const workflow = browserWorkflow({
      reasoningEffort: '<variable.effort>',
      verbosity: '{{VERBOSITY}}',
      thinkingLevel: '<start.thinking>',
      ...(zero && { temperature: '<start.temperature>' }),
    })
    const savedParams = structuredClone(workflow.blocks[1].config.params)
    const result = await new Executor({
      workflow,
      workflowInput: { thinking, temperature: 0 },
      envVarValues: { VERBOSITY: verbosity },
      workflowVariables: { effort: { name: 'effort', type: 'plain', value: effort } },
      contextExtensions: { workspaceId: 'workspace' },
    }).execute('workflow', 'start')

    expect(result.success, result.error).toBe(succeeds)
    if (succeeds) {
      expect(transport.requests).toHaveLength(1)
      expect(transport.requests[0].clientModels).toEqual([])
      const body = transport.requests[0].body
      expect(body.reasoningEffort).toBe(effort)
      expect(body.verbosity).toBe(verbosity)
      expect(body.thinkingLevel).toBe(thinking ?? '')
      expect(body.temperature).toBeUndefined()
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      for (const field of ['temperature', 'reasoning_effort', 'verbosity', 'thinking']) {
        expect(mocks.chat.mock.calls[0][0]).not.toHaveProperty(field)
      }
    } else {
      expect(result.error).toContain(
        `Cannot apply configured controls without model capabilities: ${model}`
      )
      expect(transport.requests).toHaveLength(0)
      expect(mocks.chat).not.toHaveBeenCalled()
      expect(calculateCostSummary(buildTraceSpans(result).traceSpans)).toMatchObject({
        totalCost: 0,
        totalTokens: 0,
      })
    }
    expect(transport.clientDiscoveryAttempts()).toBe(2)
    expect(transport.serverDiscoveryAttempts()).toBe(succeeds ? 2 : 1)
    expect(workflow.blocks[1].config.params).toEqual(savedParams)
  }
)

it.each([
  {
    catalog: 'unavailable',
    params: { reasoningEffort: 'auto', verbosity: 'auto', thinkingLevel: 'auto' },
    succeeds: true,
  },
  {
    catalog: 'omitted',
    params: { reasoningEffort: 'auto', verbosity: 'auto', thinkingLevel: 'auto' },
    succeeds: true,
  },
  { catalog: 'unavailable', params: {}, succeeds: true },
  { catalog: 'omitted', params: { temperature: 0, reasoningEffort: 'auto' }, succeeds: false },
  {
    catalog: 'unavailable',
    params: { reasoningEffort: 'auto', verbosity: 'high' },
    succeeds: false,
  },
  {
    catalog: 'omitted',
    params: { reasoningEffort: '<variable.effort>', verbosity: '{{REMOVED}}' },
    succeeds: false,
    error: 'Environment variable "REMOVED" was not found.',
  },
] as const)(
  'handles browser unknown capabilities: $catalog, controls=$params, succeeds=$succeeds',
  async (testCase) => {
    const { catalog, params, succeeds } = testCase
    const transport = browserTransport(catalog)
    const workflow = browserWorkflow(params)
    const savedParams = structuredClone(workflow.blocks[1].config.params)
    const result = await new Executor({
      workflow,
      contextExtensions: { workspaceId: 'workspace' },
    }).execute('workflow', 'start')
    expect(result.success).toBe(succeeds)
    if (succeeds) {
      expect(transport.requests).toHaveLength(1)
      expect(mocks.chat).toHaveBeenCalledTimes(1)
      const payload = mocks.chat.mock.calls[0][0]
      expect(payload.temperature).toBeUndefined()
      expect(payload.reasoning_effort).toBeUndefined()
      expect(payload.verbosity).toBeUndefined()
    } else {
      expect(result.error).toContain(
        'error' in testCase
          ? testCase.error
          : `Cannot apply configured controls without model capabilities: ${model}`
      )
      expect(transport.requests).toHaveLength(0)
      expect(mocks.chat).not.toHaveBeenCalled()
    }
    expect(workflow.blocks[1].config.params).toEqual(savedParams)
  }
)
