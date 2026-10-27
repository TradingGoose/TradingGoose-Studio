import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ hosted: false, resolveConfig: vi.fn() }))
vi.mock('@/lib/environment', () => ({
  get isHosted() {
    return mocks.hosted
  },
}))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveOllamaServiceConfig: mocks.resolveConfig,
}))

import { GET } from './route'

it.each([true, false])(
  'discovers Ollama only on self-hosted instances (hosted=%s)',
  async (hosted) => {
    vi.clearAllMocks()
    mocks.hosted = hosted
    mocks.resolveConfig.mockResolvedValue({ baseUrl: 'http://localhost:11434' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2' }] }),
    } as Response)

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ models: hosted ? [] : ['ollama/llama3.2'] })
    expect(mocks.resolveConfig).toHaveBeenCalledTimes(hosted ? 0 : 1)
    expect(fetch).toHaveBeenCalledTimes(hosted ? 0 : 1)
    if (!hosted) expect(fetch).toHaveBeenCalledWith('http://localhost:11434/api/tags')
  }
)
