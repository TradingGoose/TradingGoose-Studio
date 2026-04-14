import { describe, expect, it } from 'vitest'
import { buildCopilotServerToolError } from '@/lib/copilot/tools/client/server-tool-response'

describe('server-tool-response', () => {
  it('preserves status and hint for structured JSON server errors', async () => {
    const error = (await buildCopilotServerToolError(
      new Response(
        JSON.stringify({
          error: 'Invalid make_api_request payload',
          hint: 'Use uppercase HTTP methods.',
          retryable: true,
        }),
        {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )) as Error & { status?: number }

    expect(error.status).toBe(422)
    expect(error.message).toContain('Invalid make_api_request payload')
    expect(error.message).toContain('Hint: Use uppercase HTTP methods.')
  })

  it('preserves status for plain text server errors', async () => {
    const error = (await buildCopilotServerToolError(
      new Response('socket hang up', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    )) as Error & { status?: number }

    expect(error.status).toBe(500)
    expect(error.message).toBe('socket hang up')
  })
})
