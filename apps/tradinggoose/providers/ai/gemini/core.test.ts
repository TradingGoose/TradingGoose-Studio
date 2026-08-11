import type { GoogleGenAI } from '@google/genai'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRequest } from '@/providers/ai/types'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))

vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { executeGeminiRequest } from './core'

describe('executeGeminiRequest cancellation', () => {
  it('rejects when every batched tool call is aborted', async () => {
    const abortController = new AbortController()
    const functionCalls = [
      { name: 'tool-a', args: { value: 'a' } },
      { name: 'tool-b', args: { value: 'b' } },
    ]
    const generateContent = vi.fn().mockResolvedValue({
      functionCalls,
      candidates: [
        {
          content: {
            parts: functionCalls.map((functionCall) => ({ functionCall })),
          },
        },
      ],
      usageMetadata: {},
    })
    const receivedSignals: AbortSignal[] = []
    let abortedToolCalls = 0
    mockExecuteTool.mockImplementation(
      (...args: unknown[]) =>
        new Promise((_resolve, reject) => {
          const signal = (args[4] as { signal: AbortSignal }).signal
          receivedSignals.push(signal)
          signal.addEventListener(
            'abort',
            () => {
              abortedToolCalls++
              reject(new Error('tool aborted'))
            },
            { once: true }
          )
        })
    )
    const request: ProviderRequest = {
      model: 'gemini-2.5-flash',
      abortSignal: abortController.signal,
      tools: functionCalls.map(({ name }) => ({
        id: name,
        name,
        description: name,
        params: {},
        parameters: { type: 'object', properties: {}, required: [] },
      })),
    }

    const execution = executeGeminiRequest({
      ai: { models: { generateContent } } as unknown as GoogleGenAI,
      model: request.model,
      request,
      providerType: 'google',
    })
    await vi.waitFor(() => expect(mockExecuteTool).toHaveBeenCalledTimes(2))
    abortController.abort()

    await expect(execution).rejects.toThrow('tool aborted')
    expect(receivedSignals).toEqual([abortController.signal, abortController.signal])
    expect(abortedToolCalls).toBe(2)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })
})
