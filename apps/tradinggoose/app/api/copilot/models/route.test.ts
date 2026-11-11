/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ session: vi.fn(), models: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: m.session }))
vi.mock('@/lib/copilot/settings.server', () => ({ getPublicCopilotModels: m.models }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  m.session.mockResolvedValue({ user: { id: 'member' } })
  m.models.mockResolvedValue({ models: [], defaultModel: null })
})

describe('authenticated Copilot model catalog', () => {
  it('returns an empty unconfigured catalog without a hardcoded fallback', async () => {
    const response = await GET()
    expect(await response.json()).toEqual({ models: [], defaultModel: null })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns only public dynamic identities and default to a signed-in member', async () => {
    m.models.mockResolvedValue({
      models: ['openai/new-model', 'anthropic/claude-new'],
      defaultModel: 'openai/new-model',
      apiKey: 'must-remain-private',
      providers: { secret: 'must-remain-private' },
    })
    const response = await GET()
    expect(await response.json()).toEqual({
      models: ['openai/new-model', 'anthropic/claude-new'],
      defaultModel: 'openai/new-model',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each([null, {}])('requires a session (%j) before reading configuration', async (session) => {
    m.session.mockResolvedValueOnce(session)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(m.models).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps configuration diagnostics private when loading fails', async () => {
    m.models.mockRejectedValueOnce(new Error('private-settings-diagnostics'))
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Copilot models are unavailable' })
  })
})
