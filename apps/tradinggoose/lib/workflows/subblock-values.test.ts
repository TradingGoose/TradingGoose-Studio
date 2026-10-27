import { describe, expect, it, vi } from 'vitest'
import { validateWorkflowState } from '@/lib/workflows/validation'
import { ImageGeneratorBlock } from '@/blocks/blocks/image_generator'
import { SttBlock } from '@/blocks/blocks/stt'
import type { BlockState } from '@/stores/workflows/workflow/types'
import {
  buildConfiguredSubBlockParams,
  buildInitialSubBlockStates,
  resolveDisplayedSubBlockValue,
  resolveInitialSubBlockValue,
  stringifySubBlockValue,
} from './subblock-values'

vi.unmock('@/blocks/registry')

describe('buildInitialSubBlockStates', () => {
  it.each([
    [SttBlock, {}, { provider: 'whisper', model: 'whisper-1' }],
    [SttBlock, { provider: 'elevenlabs' }, { provider: 'elevenlabs', model: 'scribe_v1' }],
    [SttBlock, { provider: 'deepgram' }, { provider: 'deepgram', model: 'nova-3' }],
    [SttBlock, { provider: 'assemblyai' }, { provider: 'assemblyai', model: 'best' }],
    [SttBlock, { provider: 'gemini' }, { provider: 'gemini', model: 'gemini-2.5-flash' }],
    [
      SttBlock,
      { provider: 'elevenlabs', model: 'scribe_v1_experimental' },
      { provider: 'elevenlabs', model: 'scribe_v1_experimental' },
    ],
    [ImageGeneratorBlock, {}, { model: 'dall-e-3', size: '1024x1024' }],
    [ImageGeneratorBlock, { model: 'gpt-image-1' }, { model: 'gpt-image-1', size: 'auto' }],
  ])('initializes valid active defaults (case %#)', (config, overrides, expected) => {
    const subBlocks = buildInitialSubBlockStates(config.subBlocks, overrides)
    expect(
      Object.fromEntries(Object.entries(subBlocks).map(([id, field]) => [id, field.value]))
    ).toMatchObject(expected)
    const block: BlockState = {
      id: 'sample',
      type: config.type,
      name: config.name,
      position: { x: 0, y: 0 },
      subBlocks: subBlocks as BlockState['subBlocks'],
      outputs: {},
      enabled: true,
    }
    expect(
      validateWorkflowState({ blocks: { sample: block }, edges: [], loops: {}, parallels: {} })
        .errors
    ).toEqual([])
  })

  it('retains inactive fields, configured callbacks, and explicit overrides', () => {
    const subBlocks = buildInitialSubBlockStates(
      [
        { id: 'mode', type: 'dropdown', defaultValue: 'active' },
        { id: 'value', type: 'short-input', value: (params) => params.mode },
        {
          id: 'value',
          type: 'short-input',
          defaultValue: 'inactive',
          condition: () => ({ field: 'mode', value: 'inactive' }),
        },
        {
          id: 'items',
          type: 'long-input',
          defaultValue: '[]',
          condition: { field: 'mode', value: 'inactive' },
        },
      ],
      { mode: 'chosen' }
    )
    expect(subBlocks.value.value).toBe('chosen')
    expect(subBlocks.items.value).toBe('[]')
  })
})

describe('stringifySubBlockValue', () => {
  it.each([
    { value: ['NVDA', 'AAPL'], text: '["NVDA","AAPL"]' },
    { value: { symbol: 'NVDA' }, text: '{"symbol":"NVDA"}' },
    { value: 'NVDA', text: 'NVDA' },
    { value: 5, text: '5' },
    { value: false, text: 'false' },
    { value: null, text: '' },
    { value: undefined, text: '' },
  ])('formats $value for a text editor without losing structured values', ({ value, text }) => {
    expect(stringifySubBlockValue(value)).toBe(text)
  })
})

describe('resolveInitialSubBlockValue', () => {
  it('uses defaultValue when no explicit or configured value exists', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          type: 'code',
          value: undefined,
          defaultValue: '{\n  "example": true\n}',
        },
        {}
      )
    ).toBe('{\n  "example": true\n}')
  })

  it('prefers a configured value over defaultValue', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          type: 'dropdown',
          value: () => 'gmail_poller',
          defaultValue: 'manual',
        },
        {}
      )
    ).toBe('gmail_poller')
  })

  it('prefers an explicit override over configured and default values', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          type: 'code',
          value: () => 'configured',
          defaultValue: 'default',
        },
        {},
        'override'
      )
    ).toBe('override')
  })

  it('does not initialize selectedTriggerId from configured values', () => {
    expect(
      resolveInitialSubBlockValue(
        {
          id: 'selectedTriggerId',
          type: 'dropdown',
          value: () => 'github_webhook',
          defaultValue: 'github_webhook',
        },
        {}
      )
    ).toBe('')
  })
})

describe('resolveDisplayedSubBlockValue', () => {
  it('uses the default value for read-only fields when the stored value is blank', () => {
    expect(
      resolveDisplayedSubBlockValue(
        {
          readOnly: true,
          defaultValue: '{\n  "example": true\n}',
        },
        ''
      )
    ).toBe('{\n  "example": true\n}')
  })

  it('preserves a blank stored value for writable fields', () => {
    expect(
      resolveDisplayedSubBlockValue(
        {
          readOnly: false,
          defaultValue: '{\n  "example": true\n}',
        },
        ''
      )
    ).toBe('')
  })

  it('returns non-string defaults as cloned values for display', () => {
    expect(
      resolveDisplayedSubBlockValue(
        {
          readOnly: true,
          defaultValue: { example: true },
        },
        null
      )
    ).toEqual({ example: true })
  })
})

describe('buildConfiguredSubBlockParams', () => {
  it('does not synthesize selectedTriggerId from configured subblock defaults', () => {
    expect(
      buildConfiguredSubBlockParams({
        subBlockConfigs: [
          {
            id: 'selectedTriggerId',
            type: 'dropdown',
            value: () => 'github_webhook',
          },
        ],
        subBlocks: {},
      })
    ).toEqual({})
  })
})
