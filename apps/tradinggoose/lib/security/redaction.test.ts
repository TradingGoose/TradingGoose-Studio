import { describe, expect, it } from 'vitest'
import { deepRedactSecrets, isSensitiveDataKey, projectBoundedRedactedJson } from './redaction'

describe('security redaction', () => {
  it('redacts camel-case token keys while preserving token metrics', () => {
    expect(
      deepRedactSecrets({
        authToken: 'auth-secret',
        idToken: 'id-secret',
        inputToken: 'input-secret',
        outputToken: 'output-secret',
        token: 'bare-secret',
        tokenCount: 12,
        tokens: { completion: 9, prompt: 21, total: 30 },
        totalTokens: 42,
      })
    ).toEqual({
      authToken: '[redacted]',
      idToken: '[redacted]',
      inputToken: '[redacted]',
      outputToken: '[redacted]',
      token: '[redacted]',
      tokenCount: 12,
      tokens: { completion: 9, prompt: 21, total: 30 },
      totalTokens: 42,
    })
    expect(deepRedactSecrets({ tokenCount: 'secret-disguised-as-a-metric' })).toEqual({
      tokenCount: '[redacted]',
    })
    expect(isSensitiveDataKey('bearerToken')).toBe(true)
  })

  it('redacts headers and inline values while preserving safe text', () => {
    expect(
      deepRedactSecrets({
        headers: {
          Authorization: 'Bearer raw-header-token',
          'Private-Key': 'raw-private-key',
          'Set-Cookie': 'raw-cookie',
          'X-API-Key': 'raw-api-key',
          'X-Auth-Key': 'raw-auth-key',
        },
        message: 'password=raw-password; x-auth-key=raw-auth-key; result is safe',
      })
    ).toEqual({
      headers: {
        Authorization: '[redacted]',
        'Private-Key': '[redacted]',
        'Set-Cookie': '[redacted]',
        'X-API-Key': '[redacted]',
        'X-Auth-Key': '[redacted]',
      },
      message: 'password=[redacted]; x-auth-key=[redacted]; result is safe',
    })
  })

  it('redacts credentials from standard URI schemes, including an empty username', () => {
    expect(
      deepRedactSecrets({
        http: 'https://user:http-secret@example.test/path',
        database: 'postgresql://db-user:database-secret@database.test/app',
        emptyUsername: 'redis://:redis-secret@cache.test/0',
        safe: 'https://example.test:8443/path',
      })
    ).toEqual({
      http: 'https://[redacted]@example.test/path',
      database: 'postgresql://[redacted]@database.test/app',
      emptyUsername: 'redis://[redacted]@cache.test/0',
      safe: 'https://example.test:8443/path',
    })
  })

  it('redacts generic and camel-case token assignments in free-form text', () => {
    expect(
      deepRedactSecrets({
        errorMessage:
          'request failed: token=raw-token-value; idToken=raw-id-value; password=[redacted]; tokenCount=12',
        query: 'https://example.test/path?token=raw-query-token&safe=visible',
        json: '{"token":"raw-json-token","idToken":"raw-json-id","totalTokens":42,"safe":"visible"}',
        escapedJson: '{"token":"raw-json-\\"suffix","safe":"visible"}',
        markerPrefix: 'token=[redacted]raw-marker-secret; safe=visible',
        bracketed: 'token=abc]raw-bracket-secret; safe=visible',
      })
    ).toEqual({
      errorMessage:
        'request failed: token=[redacted]; idToken=[redacted]; password=[redacted]; tokenCount=12',
      query: 'https://example.test/path?token=[redacted]&safe=visible',
      json: '{"token":[redacted],"idToken":[redacted],"totalTokens":42,"safe":"visible"}',
      escapedJson: '{"token":[redacted],"safe":"visible"}',
      markerPrefix: 'token=[redacted]; safe=visible',
      bracketed: 'token=[redacted]; safe=visible',
    })
  })

  it('truncates multibyte strings on valid UTF-8 boundaries', () => {
    const result = projectBoundedRedactedJson('🪿'.repeat(100), {
      maxArrayItems: 4,
      maxDepth: 2,
      maxNodes: 8,
      maxObjectEntries: 4,
      maxStringBytes: 24,
    })

    expect(result.truncated).toBe(true)
    expect(result.value).toBe('🪿🪿…[truncated]')
    expect(result.value).not.toContain('�')
    expect(new TextEncoder().encode(result.value as string).byteLength).toBeLessThanOrEqual(24)
  })
})
