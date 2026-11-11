vi.mock('@/lib/mastra/connections', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/connections')>()),
  createConfiguredLanguageModel: (id: string, apiKey?: string) => ({ id, apiKey }),
}))
vi.mock('@/lib/mastra/usage-processors', () => ({
  usageProcessors: async (scope: unknown) => {
    mocks.finance(scope)
    return {
      inputProcessors: [],
      outputProcessors: [],
      getUsage: () => ({}),
      verifyComplete: async () => {},
    }
  },
}))
vi.mock('@/lib/mastra/runtime', () => ({ getMastra: async () => undefined }))

/** @vitest-environment node */
import { EMBEDDING_MODELS } from '@mastra/core/llm'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  finance: vi.fn(),
  generate: vi.fn(),
  configurations: [] as Array<Record<string, any>>,
  processFile: vi.fn(),
  download: vi.fn(),
  accounting: vi.fn(),
  sumUsage: vi.fn((steps) =>
    steps.reduce(
      (usage: any, step: any) => ({
        inputTokens: (usage.inputTokens || 0) + (step.usage?.inputTokens || 0),
        outputTokens: (usage.outputTokens || 0) + (step.usage?.outputTokens || 0),
        totalTokens: (usage.totalTokens || 0) + (step.usage?.totalTokens || 0),
      }),
      {}
    )
  ),
  mediaFetch: vi.fn(),
}))
vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(config: Record<string, any>) {
      mocks.configurations.push(config)
    }
    generate(...args: unknown[]) {
      return mocks.generate(...args)
    }
  },
}))
vi.mock('@/lib/auth/hybrid', () => ({ checkHybridAuth: mocks.auth }))
vi.mock('@/lib/mastra/usage', async (original) => ({
  ...(await original<typeof import('@/lib/mastra/usage')>()),
  getMastra: vi.fn(async () => ({})),
  resultAccounting: mocks.accounting,
  sumNativeUsage: mocks.sumUsage,
}))
vi.mock('@/lib/uploads/utils/file-processing', () => ({
  processSingleFileToUserFile: mocks.processFile,
  downloadFileFromStorage: mocks.download,
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => crypto.randomUUID() }))

import { POST } from './route'

function request(body: Record<string, unknown>, query = '') {
  return new NextRequest(`http://localhost/api/tools/vision/analyze${query}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configurations.length = 0
  mocks.auth.mockResolvedValue({ success: true, userId: 'user-1', workspaceId: 'workspace-1' })
  mocks.generate.mockResolvedValue({
    finishReason: 'stop',
    text: 'A goose',
    usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
  })
  mocks.accounting.mockResolvedValue({
    tokens: { prompt: 12, completion: 3, total: 15 },
    cost: { status: 'unavailable' },
  })
  mocks.mediaFetch.mockImplementation(
    async () =>
      new Response(new Uint8Array(Buffer.from('source image bytes')), {
        headers: { 'content-type': 'image/png' },
      })
  )
  vi.stubGlobal('fetch', mocks.mediaFetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('native Vision input and authorization', () => {
  it.each([
    '?workflowId=',
    '?workspaceId=%20',
    '?workflowId=a&workflowId=b',
    '?workspaceId=a&workspaceId=a',
  ])('refuses malformed query scope %s before finance, uploads or model contact', async (query) => {
    const response = await POST(request({ imageFile: { name: 'image.png' } }, query))
    expect(response.status).toBe(400)
    expect(mocks.finance).not.toHaveBeenCalled()
    expect(mocks.processFile).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('refuses a workspace API key conflict before contact instead of replacing its authority', async () => {
    const response = await POST(
      request({ imageUrl: 'https://example.com/image.png' }, '?workspaceId=other')
    )
    expect(response.status).toBe(403)
    expect(mocks.finance).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it.each([
    ['?workflowId=%20workflow-b%20&workspaceId=%20workspace-b%20', 'workflow-b', 'workspace-b'],
    ['', undefined, undefined],
  ])(
    'retains normalized query or genuinely personal scope %s',
    async (query, workflowId, workspaceId) => {
      mocks.auth.mockResolvedValue({ success: true, userId: 'user-1', authType: 'internal' })
      const response = await POST(request({ imageUrl: 'https://example.com/image.png' }, query))
      expect(response.status).toBe(200)
      expect(mocks.finance).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: 'user-1',
          workflowId,
          workspaceId,
          purpose: 'vision',
          signal: expect.any(AbortSignal),
        })
      )
    }
  )

  it('retains matching authoritative API key and query workspace with workflow provenance', async () => {
    const response = await POST(
      request(
        { imageUrl: 'https://example.com/image.png' },
        '?workspaceId=workspace-1&workflowId=workflow-1'
      )
    )
    expect(response.status).toBe(200)
    expect(mocks.finance).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    )
  })

  it('requires authentication before model or upload execution', async () => {
    mocks.auth.mockResolvedValue({ success: false, error: 'Authentication required' })
    const response = await POST(
      request({ model: 'openai/gpt-4o', imageUrl: 'https://example.com/goose.png' })
    )
    expect(response.status).toBe(401)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('retains canonical Anthropic routing, native messages, prompts and missing dollars', async () => {
    const response = await POST(
      request({
        model: 'anthropic/claude-opus-4-6',
        apiKey: 'request-key',
        imageUrl: 'https://example.com/goose.png',
        prompt: 'Read the sign',
      })
    )
    expect(response.status).toBe(200)
    expect(mocks.configurations[0].model).toEqual({
      id: 'anthropic/claude-opus-4-6',
      apiKey: 'request-key',
    })
    expect(mocks.generate).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read the sign' },
            {
              type: 'image',
              image: Buffer.from('source image bytes'),
              mediaType: undefined,
            },
          ],
        },
      ],
      expect.objectContaining({
        modelSettings: { maxOutputTokens: 1024, maxRetries: 0 },
        abortSignal: expect.any(AbortSignal),
      })
    )
    expect(await response.json()).toMatchObject({
      output: {
        content: 'A goose',
        model: 'anthropic/claude-opus-4-6',
        tokens: 15,
        cost: { status: 'unavailable' },
      },
    })
    expect(mocks.accounting).toHaveBeenCalledWith({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
    })
    expect(mocks.mediaFetch).toHaveBeenCalledTimes(1)
    expect(mocks.mediaFetch.mock.calls[0][1].headers).toBeUndefined()
  })

  it('preserves upload/storage processing with trusted requester/signal and native bytes', async () => {
    const upload = { id: 'file-1', name: 'goose.png', type: 'image/png' }
    mocks.processFile.mockReturnValue(upload)
    mocks.download.mockResolvedValue(Buffer.from('image bytes'))
    const response = await POST(request({ model: 'openai/gpt-4o', imageFile: upload }))
    expect(response.status).toBe(200)
    expect(mocks.processFile).toHaveBeenCalledWith(upload, expect.any(String), expect.anything())
    expect(mocks.download).toHaveBeenCalledWith(upload, expect.any(String), expect.anything(), {
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      signal: expect.any(AbortSignal),
    })
    expect(mocks.generate.mock.calls[0][0][0].content[1]).toEqual({
      type: 'image',
      image: Buffer.from('image bytes'),
      mediaType: 'image/png',
    })
    expect(mocks.mediaFetch).not.toHaveBeenCalled()
  })

  it.each(['/api/files/serve/%252fprivate'])(
    'refuses malformed media %s before finance/model/fetch',
    async (imageUrl) => {
      const response = await POST(request({ imageUrl, apiKey: 'request-key' }))
      expect(response.status).toBe(403)
      expect(mocks.mediaFetch).not.toHaveBeenCalled()
      expect(mocks.finance).not.toHaveBeenCalled()
      expect(mocks.generate).not.toHaveBeenCalled()
      expect(mocks.configurations).toHaveLength(0)
    }
  )

  it('refuses an invalid redirect after canceling its response', async () => {
    const cancel = vi.fn()
    mocks.mediaFetch.mockImplementationOnce(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          status: 302,
          headers: { location: 'file:///private.png' },
        })
    )
    const response = await POST(request({ imageUrl: 'https://public.fixture/redirect' }))
    expect(response.status).toBe(403)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(mocks.mediaFetch).toHaveBeenCalledTimes(1)
    expect(mocks.finance).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('cancels a wrong-MIME body and refuses before financial contact', async () => {
    const cancel = vi.fn()
    mocks.mediaFetch.mockImplementationOnce(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { 'content-type': 'text/plain' },
        })
    )
    const response = await POST(request({ imageUrl: 'https://public.fixture/not-image' }))
    expect(response.status).toBe(400)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(mocks.finance).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it.each(['gpt-4o', 'unknown/not-a-model'])(
    'rejects incompatible selection %s before inference',
    async (model) => {
      const response = await POST(request({ model, imageUrl: 'https://example.com/image.png' }))
      expect(response.status).toBe(400)
      expect((await response.json()).error).toContain('Select a listed provider/model')
      expect(mocks.generate).not.toHaveBeenCalled()
    }
  )

  it('keeps concurrent request keys isolated', async () => {
    await Promise.all(
      ['one', 'two'].map((apiKey) =>
        POST(request({ apiKey, model: 'openai/gpt-4o', imageUrl: 'https://example.com/goose.png' }))
      )
    )
    expect(mocks.configurations.map((config) => config.model.apiKey).sort()).toEqual(['one', 'two'])
    expect(mocks.configurations[0]).not.toBe(mocks.configurations[1])
  })
})

describe('Vision failure accounting boundary', () => {
  it.each(['aborted', 'abort', 'error'])(
    'rejects native %s outcomes with available usage',
    async (finishReason) => {
      mocks.generate.mockResolvedValue({
        finishReason,
        text: 'partial',
        usage: { totalTokens: 15 },
      })
      const response = await POST(
        request({ model: 'openai/gpt-4o', imageUrl: 'https://example.com/image.png' })
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({
        success: false,
        tokens: { total: 15 },
        cost: { status: 'unavailable' },
      })
    }
  )
  it('retains completed step usage when later generation rejects', async () => {
    mocks.generate.mockImplementation(async (_messages, options) => {
      options.onStepFinish({ usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } })
      options.onStepFinish({ usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } })
      throw new Error('later step failed')
    })
    const response = await POST(
      request({ model: 'openai/gpt-4o', imageUrl: 'https://example.com/image.png' })
    )
    expect(response.status).toBe(500)
    expect(mocks.accounting).toHaveBeenCalledWith({
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 20,
    })
    expect(await response.json()).toMatchObject({
      tokens: { total: 15 },
      cost: { status: 'unavailable' },
    })
  })
  it('rejects a missing native analysis', async () => {
    mocks.generate.mockResolvedValue({ finishReason: 'stop', text: '' })
    const response = await POST(
      request({ model: 'openai/gpt-4o', imageUrl: 'https://example.com/image.png' })
    )
    expect(response.status).toBe(500)
    expect((await response.json()).error).toContain('no analysis')
  })
})

it.each(EMBEDDING_MODELS.map(({ provider, id }) => [`${provider}/${id}`, provider, id] as const))(
  'refuses native-known embedding model %s before generation admission or model contact',
  async (model, provider, modelId) => {
    // Trusted deployment membership is explicit; purpose rejection uses real installed native metadata.
    vi.stubEnv(
      'MASTRA_MODEL_PROVIDERS',
      JSON.stringify({
        [provider]: {
          name: 'Controlled registered provider',
          url: 'https://not-contacted.invalid',
          models: [modelId],
        },
      })
    )
    try {
      const response = await POST(request({ model, imageUrl: 'https://example.com/image.png' }))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        success: false,
        error: expect.stringContaining('Select a listed provider/model'),
      })
      expect(mocks.finance).not.toHaveBeenCalled()
      expect(mocks.processFile).not.toHaveBeenCalled()
      expect(mocks.download).not.toHaveBeenCalled()
      expect(mocks.generate).not.toHaveBeenCalled()
      expect(mocks.configurations).toEqual([])
      expect(mocks.accounting).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  }
)
