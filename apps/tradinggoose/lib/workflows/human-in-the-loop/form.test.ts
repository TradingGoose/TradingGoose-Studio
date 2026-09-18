/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { normalizeWorkflowPauseInputFormat, validateWorkflowPauseInput } from './form'

describe('human review form contract', () => {
  it('normalizes editor placeholder fields without inventing field types', () => {
    expect(normalizeWorkflowPauseInputFormat([{ name: '' }, { name: ' answer ' }])).toEqual([
      { name: 'answer', type: 'string', required: false },
    ])
  })

  it('accepts field names supported by the existing editor', () => {
    expect(
      normalizeWorkflowPauseInputFormat([{ name: '_answer' }, { name: 'review-note' }])
    ).toHaveLength(2)
  })

  it('does not reserve names from discarded resume output shapes', () => {
    expect(
      normalizeWorkflowPauseInputFormat([
        { name: 'submission' },
        { name: 'resume' },
        { name: '_pauseMetadata' },
        { name: 'kind' },
      ])
    ).toHaveLength(4)
  })

  it('requires canonical file descriptors, not invented URL-only file objects', () => {
    const fields = normalizeWorkflowPauseInputFormat([{ name: 'attachments', type: 'files' }])
    expect(() =>
      validateWorkflowPauseInput(fields, { attachments: [{ name: 'note.txt', url: '/file' }] })
    ).toThrow()
    const file = {
      id: 'file',
      name: 'note.txt',
      url: '/file',
      size: 3,
      type: 'text/plain',
      key: 'key',
      uploadedAt: '2026-09-01',
      expiresAt: '2026-09-02',
    }
    expect(validateWorkflowPauseInput(fields, { attachments: [file] })).toEqual({
      attachments: [file],
    })
  })

  it.each([
    [{ name: 'constructor' }],
    [{ name: '__proto__' }],
    [{ name: 'resumeEndpoint' }],
    [{ name: 'response' }],
    [{ name: 'error' }],
    [{ name: 'stream' }],
    [{ name: 'execution' }],
    [{ name: 'url' }],
    [{ name: 'answer' }, { name: 'answer' }],
    [{ name: 1 }],
    [null],
    [{ name: 'answer', type: 'json' }],
  ])('rejects malformed, duplicate and reserved field definitions: %j', (...fields) => {
    expect(() => normalizeWorkflowPauseInputFormat(fields)).toThrow()
  })

  it('validates canonical types without coercing strings into numbers or booleans', () => {
    const fields = normalizeWorkflowPauseInputFormat([
      { name: 'amount', type: 'number', required: true },
      { name: 'approved', type: 'boolean' },
      { name: 'metadata', type: 'object' },
      { name: 'choices', type: 'array' },
      { name: 'listing', type: 'listingIdentity' },
    ])
    const input = {
      amount: 0,
      approved: false,
      metadata: {},
      choices: [],
      listing: { listing_id: 'AAPL', listing_type: 'default', base_id: '', quote_id: '' },
    }
    expect(validateWorkflowPauseInput(fields, input)).toEqual(input)
    for (const value of ['1', true, null, Number.NaN]) {
      expect(() => validateWorkflowPauseInput(fields, { amount: value })).toThrow()
    }
    expect(() =>
      validateWorkflowPauseInput(fields, { amount: 1, listing: { symbol: 'AAPL' } })
    ).toThrow()
  })

  it('rejects extra fields, inherited values and oversized submissions', () => {
    const fields = normalizeWorkflowPauseInputFormat([{ name: 'answer', required: true }])
    expect(() => validateWorkflowPauseInput(fields, { answer: 'yes', extra: true })).toThrow()
    expect(() => validateWorkflowPauseInput(fields, Object.create({ answer: 'yes' }))).toThrow()
    expect(() => validateWorkflowPauseInput(fields, { answer: 'x'.repeat(256_001) })).toThrow()
    expect(validateWorkflowPauseInput([], {})).toEqual({})
  })
})
