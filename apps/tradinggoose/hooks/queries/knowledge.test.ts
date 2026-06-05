import { describe, expect, it } from 'vitest'
import {
  getKnowledgeQueryErrorCode,
  getKnowledgeQueryErrorMessage,
  KnowledgeQueryError,
} from './knowledge'

describe('knowledge query errors', () => {
  it('exposes stable internal codes for query failures', () => {
    const error = new KnowledgeQueryError('failedToFetchDocuments')

    expect(getKnowledgeQueryErrorCode(error)).toBe('failedToFetchDocuments')
    expect(getKnowledgeQueryErrorMessage(error)).toBe('Failed to fetch documents')
  })

  it('falls back to regular error messages for non-knowledge errors', () => {
    const error = new Error('boom')

    expect(getKnowledgeQueryErrorCode(error)).toBeNull()
    expect(getKnowledgeQueryErrorMessage(error)).toBe('boom')
  })
})
