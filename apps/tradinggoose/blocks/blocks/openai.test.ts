import { afterEach, expect, it, vi } from 'vitest'
import { OpenAIBlock } from './openai'

afterEach(() => vi.unstubAllGlobals())
it('loads qualified OpenAI models through the authenticated native embedding projection', async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      models: [
        { id: 'openai/native-a', provider: 'openai' },
        { id: 'google/native-b', provider: 'google' },
      ],
    })
  )
  vi.stubGlobal('fetch', fetch)
  const picker = OpenAIBlock.subBlocks.find(({ id }) => id === 'model')!
  expect(picker.options).toBeUndefined()
  expect(picker.value?.({})).toBe('openai/text-embedding-3-small')
  expect(
    await picker.fetchOptions!('block', 'model', { channelId: 'fixture', workflowId: null })
  ).toEqual([{ id: 'openai/native-a', label: 'openai/native-a' }])
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/models?type=embedding')
  expect(OpenAIBlock.tools.access).toEqual(['openai_embeddings'])
})
it('uses the existing dropdown error flow when native discovery fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
  const picker = OpenAIBlock.subBlocks.find(({ id }) => id === 'model')!
  await expect(
    picker.fetchOptions!('block', 'model', { channelId: 'fixture', workflowId: null })
  ).rejects.toThrow('Unable to load listed embedding models')
})
