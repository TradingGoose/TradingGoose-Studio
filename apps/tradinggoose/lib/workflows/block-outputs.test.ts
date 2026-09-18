import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBlock } from '@/blocks'
import { ResponseBlock } from '@/blocks/blocks/response'
import { getBlockOutputPaths, getBlockOutputType, readBlockOutputs } from './block-outputs'

vi.mock('@/blocks', () => ({ getBlock: vi.fn() }))
vi.mock('@/triggers', () => ({ getTrigger: vi.fn() }))

const outputs = {
  result: {
    type: 'object',
    description: 'Schema metadata must not become an output path',
    properties: {
      account: {
        type: 'object',
        properties: {
          balance: { type: 'number' },
          files: { type: 'files' },
        },
      },
      type: { type: 'string' },
      properties: { type: 'object', properties: { description: { type: 'boolean' } } },
    },
  },
  namespace: { nested: { type: 'string' }, type: { type: 'number' } },
  generic: { type: 'object' },
  empty: { type: 'object', properties: {} },
  primitive: 'boolean',
  type: { type: 'string' },
  files: { type: 'files' },
}

describe('block output schema traversal', () => {
  beforeEach(() => {
    vi.mocked(getBlock).mockReturnValue({ outputs } as unknown as ReturnType<typeof getBlock>)
  })

  it('exposes the actual Response block envelope through canonical object properties', () => {
    vi.mocked(getBlock).mockReturnValue(ResponseBlock)
    expect(getBlockOutputPaths('response')).toEqual([
      'response',
      'response.data',
      'response.status',
      'response.headers',
    ])
    expect(getBlockOutputType('response', 'response')).toBe('object')
    expect(getBlockOutputType('response', 'response.data')).toBe('json')
    expect(getBlockOutputType('response', 'response.status')).toBe('number')
  })

  it.each([
    ['api_trigger', [], []],
    ['input_trigger', 'invalid', []],
    ['api_trigger', undefined, ['default']],
    ['generic_webhook', [], ['default']],
    ['generic_webhook', 'invalid', ['default']],
    ['generic_webhook', [{ name: 'answer', type: 'boolean' }], ['answer']],
    ['human_in_the_loop', [{ name: 'answer', type: 'boolean' }], ['default', 'answer']],
    ['human_in_the_loop', [], ['default']],
  ])('preserves static and dynamic output rules for %s with %j', (blockType, value, keys) => {
    vi.mocked(getBlock).mockReturnValue({
      ...ResponseBlock,
      subBlocks: [{ id: 'inputFormat', type: 'input-format', title: 'Fields', layout: 'full' }],
      outputs: { default: { type: 'string' } },
    })
    expect(Object.keys(readBlockOutputs(blockType as string, { inputFormat: { value } }))).toEqual(
      keys
    )
  })

  it('exposes object values and recursively declared properties without schema metadata', () => {
    expect(getBlockOutputPaths('test')).toEqual([
      'result',
      'result.account',
      'result.account.balance',
      'result.account.files.url',
      'result.account.files.name',
      'result.account.files.size',
      'result.account.files.type',
      'result.account.files.key',
      'result.account.files.uploadedAt',
      'result.account.files.expiresAt',
      'result.type',
      'result.properties',
      'result.properties.description',
      'namespace.nested',
      'namespace.type',
      'generic',
      'empty',
      'primitive',
      'type',
      'files.url',
      'files.name',
      'files.size',
      'files.type',
      'files.key',
      'files.uploadedAt',
      'files.expiresAt',
    ])
  })

  it.each([
    ['result', 'object'],
    ['result.account', 'object'],
    ['result.account.balance', 'number'],
    ['result.account.files', 'files'],
    ['result.account.files[0].size', 'number'],
    ['result.account.files[1].type', 'string'],
    ['result.type', 'string'],
    ['result.properties', 'object'],
    ['result.properties.description', 'boolean'],
    ['namespace.nested', 'string'],
    ['namespace.type', 'number'],
    ['generic', 'object'],
    ['empty', 'object'],
    ['primitive', 'boolean'],
    ['type', 'string'],
    ['files[0].url', 'string'],
    ['files[0].size', 'number'],
  ])('resolves %s as %s', (path, type) => {
    expect(getBlockOutputType('test', path)).toBe(type)
  })

  it.each([
    '',
    'missing',
    'result.description',
    'result.account.properties',
    'result.account.balance.type',
    'result.account.files.missing',
    'result.account.files.constructor',
    'result.account.files.toString',
    'result.account.files.size.missing',
    'result.type.missing',
    'generic.type',
    'empty.missing',
    'namespace',
    'namespace.missing',
    'primitive.missing',
  ])('returns any for non-output path %s', (path) => {
    expect(getBlockOutputType('test', path)).toBe('any')
  })
})
