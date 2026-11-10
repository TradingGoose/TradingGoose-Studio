import { describe, expect, it } from 'vitest'
import {
  type ArchiveReference,
  byteDigest,
  createArchiveBytes,
  decodeFunctionalValue,
  encodeFunctionalValue,
  functionalDigest,
  readArchiveBytes,
} from './format'

describe('private current functional archive format', () => {
  const messages = [
    {
      role: 'user',
      content:
        ' \n\tBefore user\n```xml\n<working_memory>literal user 🔥</working_memory>\n```\nAfter user\t \n',
    },
    {
      role: 'assistant',
      content:
        '\t \nBefore assistant\n```ts\nconst literal = "<working_memory>literal assistant 🔥</working_memory>"\n```\nAfter assistant \n\t',
    },
  ]
  it('preserves ordered maps/sets, undefined/null, negative zero, Unicode, exact text and checkpoint ciphertext', () => {
    const payload = {
      messages,
      empty: '',
      systems: ['repeat', 'repeat', ' \n🔥 '],
      absent: undefined,
      nil: null,
      negative: -0,
      date: new Date('2026-01-01'),
      map: new Map([
        ['a', { n: 1 }],
        ['b', { n: 2 }],
      ]),
      set: new Set(['b', 'a']),
      encryptedCheckpoint: 'ciphertext-only',
    }
    expect(decodeFunctionalValue(encodeFunctionalValue(payload))).toEqual(payload)
    expect(functionalDigest(payload)).toBe(functionalDigest({ ...payload }))
    expect(functionalDigest({ ...payload, systems: ['repeat', 'repeat', '\n🔥 '] })).not.toBe(
      functionalDigest(payload)
    )
    expect(
      functionalDigest({
        ...payload,
        messages: [{ ...messages[0], content: messages[0].content.trim() }, messages[1]],
      })
    ).not.toBe(functionalDigest(payload))
    expect(
      functionalDigest({
        ...payload,
        messages: [
          messages[0],
          { ...messages[1], content: messages[1].content.replace('literal assistant', 'changed') },
        ],
      })
    ).not.toBe(functionalDigest(payload))
  })
  it('binds private bytes to exact scope and rejects corruption before projection', () => {
    const scope = { workspaceId: 'workspace', executionId: 'execution', logId: 'log' }
    const bytes = createArchiveBytes(scope, {
      messages,
      output: { model: 'intentional user field', tokens: 2 },
    })
    const digest = byteDigest(bytes)
    const ref: ArchiveReference = {
      version: 1,
      purpose: 'workflow-archive',
      ...scope,
      provider: 'local',
      key: `archived-enhanced-logs/${digest.slice(0, 2)}/${digest}.json`,
      digest,
    }
    expect(readArchiveBytes(ref, bytes)).toEqual({
      messages,
      output: { model: 'intentional user field', tokens: 2 },
    })
    expect(() => readArchiveBytes({ ...ref, workspaceId: 'another' }, bytes)).toThrow('scope')
    expect(() => readArchiveBytes(ref, Buffer.concat([bytes, Buffer.from('x')]))).toThrow('digest')
  })
  it('rejects unrepresentable source rather than silently erasing it', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      BigInt(1),
      () => {},
      Symbol('value'),
    ])
      expect(() => encodeFunctionalValue(value)).toThrow('preserve original')
    expect(() =>
      decodeFunctionalValue([
        'object',
        [
          ['a', ['number', 1]],
          ['a', ['number', 2]],
        ],
      ])
    ).toThrow()
  })
})
