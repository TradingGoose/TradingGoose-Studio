import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/ai/types'

const { mockExecuteGeminiRequest, mockGoogleGenAI } = vi.hoisted(() => ({
  mockExecuteGeminiRequest: vi.fn(),
  mockGoogleGenAI: vi.fn(),
}))

vi.mock('@google/genai', () => ({ GoogleGenAI: mockGoogleGenAI }))
vi.mock('@/providers/ai/gemini/core', () => ({
  executeGeminiRequest: mockExecuteGeminiRequest,
}))

import { googleProvider } from '@/providers/ai/google'

describe('Google provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteGeminiRequest.mockResolvedValue({ content: '', model: 'gemini-2.5-flash' })
  })

  it('delegates Gemini thinking requests to the shared Gemini core', async () => {
    const request: ProviderRequest = {
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      thinkingLevel: 'none',
    }

    await googleProvider.executeRequest(request)

    expect(mockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' })
    expect(mockExecuteGeminiRequest).toHaveBeenCalledWith({
      ai: expect.anything(),
      model: 'gemini-2.5-flash',
      request,
      providerType: 'google',
    })
  })

  it('requires an API key before creating the client', async () => {
    await expect(
      googleProvider.executeRequest({ model: 'gemini-2.5-pro' } as ProviderRequest)
    ).rejects.toThrow('API key is required for Google Gemini')
    expect(mockGoogleGenAI).not.toHaveBeenCalled()
  })
})
