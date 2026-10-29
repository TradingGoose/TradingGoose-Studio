import { describe, expect, it } from 'vitest'
import { getBedrockModelId } from '@/providers/ai/bedrock/utils'

describe('getBedrockModelId', () => {
  it.each([
    'minimax.minimax-m2.5',
    'zai.glm-5',
    'moonshotai.kimi-k2.5',
    'deepseek.v3.2',
    'mistral.mistral-large-3-675b-instruct',
    'mistral.magistral-small-2509',
    'mistral.ministral-3-14b-instruct',
    'mistral.ministral-3-8b-instruct',
    'mistral.ministral-3-3b-instruct',
    'mistral.mixtral-8x7b-instruct-v0:1',
  ])('uses the in-region ID for %s', (model) => {
    for (const region of ['us-east-1', 'eu-west-1', 'ap-southeast-2', 'us-gov-west-1']) {
      expect(getBedrockModelId(`bedrock/${model}`, region)).toBe(model)
    }
  })

  it.each(['openai.gpt-oss-120b-1:0', 'openai.gpt-oss-20b-1:0'])(
    'uses a geographic profile for %s only in GovCloud',
    (model) => {
      for (const region of ['us-east-1', 'eu-west-1', 'ap-southeast-2']) {
        expect(getBedrockModelId(`bedrock/${model}`, region)).toBe(model)
      }
      expect(getBedrockModelId(`bedrock/${model}`, 'us-gov-west-1')).toBe(`us-gov.${model}`)
    }
  )

  it.each([
    ['anthropic.claude-sonnet-4-5-20250929-v1:0', 'us-east-1', 'us'],
    ['anthropic.claude-sonnet-4-5-20250929-v1:0', 'ap-southeast-2', 'apac'],
    ['amazon.nova-pro-v1:0', 'eu-west-1', 'eu'],
  ])('preserves the geographic profile for %s in %s', (model, region, prefix) => {
    expect(getBedrockModelId(`bedrock/${model}`, region)).toBe(`${prefix}.${model}`)
  })

  it('rejects invalid namespaces, unknown models, and unsupported geographic regions', () => {
    expect(() => getBedrockModelId('minimax.minimax-m2.5', 'us-east-1')).toThrow(
      'Invalid Bedrock model ID'
    )
    expect(() => getBedrockModelId('bedrock/unknown', 'us-east-1')).toThrow('Unknown Bedrock model')
    expect(() => getBedrockModelId('bedrock/amazon.nova-pro-v1:0', 'unknown')).toThrow(
      'Unsupported Bedrock region'
    )
  })
})
