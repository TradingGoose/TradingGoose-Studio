import { expect, it } from 'vitest'
import { getInferenceFacts } from '@/lib/mastra/result'
import { embeddingsTool } from './embeddings'

const output = {
  embeddings: [[0.1, 0.2]],
  model: 'openai/text-embedding-3-small',
  tokens: { prompt: 4, total: 4 },
  cost: { status: 'unavailable' },
  embeddingUsage: { status: 'reported', batches: 1 },
}
it('uses the internal signed tool transport and forwards only intended embedding fields', () => {
  expect(embeddingsTool.request.url).toBe('/api/tools/openai/embeddings')
  expect(embeddingsTool.request.headers({ apiKey: 'request-key', input: 'exact input' })).toEqual({
    'Content-Type': 'application/json',
  })
  expect(
    embeddingsTool.request.body!({
      apiKey: 'request-key',
      input: ['  exact🔥\n', 'same'],
      actorUserId: 'forged',
      runId: 'forged',
      encodingFormat: 'base64',
      _context: { workspaceId: 'forged' },
    } as any)
  ).toEqual({
    input: ['  exact🔥\n', 'same'],
    model: 'openai/text-embedding-3-small',
    apiKey: 'request-key',
  })
  expect(embeddingsTool.params).not.toHaveProperty('encodingFormat')
  expect(embeddingsTool.params).not.toHaveProperty('user')
})
it('retains only controlled response fields and brands available active facts', async () => {
  const result = await embeddingsTool.transformResponse!(
    Response.json({
      success: true,
      output: { ...output, providerResponse: 'private', apiKey: 'private' },
      headers: 'private',
    })
  )
  expect(result.success).toBe(true)
  expect(result.output).toMatchObject(output)
  expect(Object.keys(result.output)).toEqual(Object.keys(output))
  expect(getInferenceFacts(result.output)).toMatchObject({
    model: output.model,
    tokens: output.tokens,
    cost: output.cost,
  })
  expect(JSON.stringify(result)).not.toContain('private')
})
it('preserves application failure and completed vectors through HTTP200 without changing it into success', async () => {
  const result = await embeddingsTool.transformResponse!(
    Response.json({
      success: false,
      error: 'Later batch failed',
      output: { ...output, embeddingUsage: { status: 'partial', batches: 1 } },
    })
  )
  expect(result).toMatchObject({
    success: false,
    error: 'Later batch failed',
    output: { embeddings: output.embeddings, embeddingUsage: { status: 'partial', batches: 1 } },
  })
  expect(getInferenceFacts(result.output)?.cost).toEqual({ status: 'unavailable' })
})
it('leaves absent native counters absent and rejects precontact route failures', async () => {
  const result = await embeddingsTool.transformResponse!(
    Response.json({
      success: true,
      output: {
        ...output,
        tokens: {},
        embeddingUsage: { status: 'unavailable', batches: 1 },
      },
    })
  )
  expect(result.output.tokens).toEqual({})
  await expect(
    embeddingsTool.transformResponse!(
      Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    )
  ).rejects.toThrow('Unauthorized')
})
