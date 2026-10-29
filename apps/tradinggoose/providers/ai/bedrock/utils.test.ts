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
    ['anthropic.claude-opus-5', 'ap-southeast-2', 'au'],
    ['anthropic.claude-opus-5', 'ap-south-1', 'in'],
    ['anthropic.claude-opus-4-8', 'ap-northeast-1', 'jp'],
    ['anthropic.claude-opus-4-8', 'us-gov-west-1', 'us-gov'],
    ['anthropic.claude-sonnet-4-5-20250929-v1:0', 'ap-southeast-2', 'au'],
    ['anthropic.claude-haiku-4-5-20251001-v1:0', 'ap-south-2', 'in'],
    ['openai.gpt-6.1-sol', 'us-east-1', 'us'],
    ['amazon.nova-2-lite-v1:0', 'ap-northeast-3', 'jp'],
    ['amazon.nova-lite-v1:0', 'ca-central-1', 'ca'],
    ['amazon.nova-pro-v1:0', 'eu-west-1', 'eu'],
    ['amazon.nova-pro-v1:0', 'ap-southeast-2', 'apac'],
  ])('preserves the geographic profile for %s in %s', (model, region, prefix) => {
    expect(getBedrockModelId(`bedrock/${model}`, region)).toBe(`${prefix}.${model}`)
  })

  it.each([
    ['openai.gpt-6.1-sol', 'eu-west-1'],
    ['openai.gpt-6-astra', 'ap-southeast-2'],
    ['openai.gpt-5.6-sol', 'eu-west-1'],
    ['anthropic.claude-fable-5', 'eu-west-1'],
    ['anthropic.claude-opus-4-5-20251101-v1:0', 'ap-southeast-2'],
    ['meta.llama4-maverick-17b-instruct-v1:0', 'eu-west-1'],
    ['mistral.pixtral-large-2502-v1:0', 'ap-southeast-2'],
  ])('rejects unsupported geographic inference for %s in %s', (model, region) => {
    expect(() => getBedrockModelId(`bedrock/${model}`, region)).toThrow(
      'No supported Bedrock invocation'
    )
  })

  it.each([
    ['anthropic.claude-opus-5', 'ap-northeast-2'],
    ['amazon.nova-micro-v1:0', 'ap-southeast-2'],
    ['amazon.nova-pro-v1:0', 'us-gov-west-1'],
  ])('uses the documented in-region deployment for %s in %s', (model, region) => {
    expect(getBedrockModelId(`bedrock/${model}`, region)).toBe(model)
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
