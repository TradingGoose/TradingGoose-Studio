/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRuntimeEnv, mockGetEnv } = vi.hoisted(() => {
  const runtimeEnv: Record<string, string | undefined> = {}
  return {
    mockRuntimeEnv: runtimeEnv,
    mockGetEnv: vi.fn((key: string) => runtimeEnv[key]),
  }
})

vi.mock('../env', () => ({
  env: {
    NODE_ENV: 'production',
  },
  getEnv: mockGetEnv,
}))

import { buildCSPString, generateRuntimeCSP, getMainCSPPolicy } from './csp'

function tokenizeCsp(policy: string): string[] {
  return policy.split(/[;\s]+/).filter(Boolean)
}

describe('CSP helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mockRuntimeEnv)) {
      delete mockRuntimeEnv[key]
    }
    mockRuntimeEnv.NODE_ENV = 'production'
  })

  it('drops empty and undefined-like sources when building a CSP string', () => {
    expect(
      buildCSPString({
        'connect-src': [
          "'self'",
          '',
          'undefined',
          'null',
          undefined as unknown as string,
          'https://api.example.com',
        ],
      } as any)
    ).toBe("connect-src 'self' https://api.example.com")
  })

  it('keeps the build-time policy on explicit sources only', () => {
    const tokens = tokenizeCsp(getMainCSPPolicy())

    expect(tokens).not.toContain('http:')
    expect(tokens).not.toContain('https:')
    expect(tokens).not.toContain('ws:')
    expect(tokens).not.toContain('wss:')
  })

  it('keeps the runtime policy on explicit origins without broad scheme relaxations', async () => {
    mockRuntimeEnv.NEXT_PUBLIC_APP_URL = 'https://app.example.com/dashboard'
    mockRuntimeEnv.NEXT_PUBLIC_SOCKET_URL = 'https://socket.example.com/realtime'

    const policy = await generateRuntimeCSP()
    const tokens = tokenizeCsp(policy)

    expect(tokens).not.toContain('http:')
    expect(tokens).not.toContain('https:')
    expect(tokens).not.toContain('ws:')
    expect(tokens).not.toContain('wss:')
    expect(tokens).toContain('https://app.example.com')
    expect(tokens).toContain('https://socket.example.com')
    expect(tokens).toContain('wss://socket.example.com')
    expect(policy).not.toContain('undefined')
  })

  it('falls back to concrete socket defaults when the socket env is unset', async () => {
    mockRuntimeEnv.NEXT_PUBLIC_APP_URL = 'undefined'

    const policy = await generateRuntimeCSP()
    const tokens = tokenizeCsp(policy)

    expect(tokens).toContain('http://localhost:3002')
    expect(tokens).toContain('ws://localhost:3002')
    expect(policy).not.toContain('undefined')
  })
})
