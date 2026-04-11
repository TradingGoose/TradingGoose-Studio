/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAddToWaitlist, mockGetRegistrationMode } = vi.hoisted(() => ({
  mockAddToWaitlist: vi.fn(),
  mockGetRegistrationMode: vi.fn(),
}))

vi.mock('@/lib/registration/service', () => ({
  addToWaitlist: (...args: unknown[]) => mockAddToWaitlist(...args),
  getRegistrationMode: (...args: unknown[]) => mockGetRegistrationMode(...args),
}))

describe('waitlist route', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('accepts waitlist submissions only in waitlist mode', async () => {
    mockGetRegistrationMode.mockResolvedValue('waitlist')
    mockAddToWaitlist.mockResolvedValue({
      id: 'entry_123',
      email: 'goose@example.com',
      status: 'pending',
    })

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email: 'goose@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: 'entry_123',
      email: 'goose@example.com',
      status: 'pending',
    })
    expect(mockAddToWaitlist).toHaveBeenCalledWith('goose@example.com')
  })

  it('rejects submissions when registration is open', async () => {
    mockGetRegistrationMode.mockResolvedValue('open')

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email: 'goose@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Registration is open. Sign up directly.',
    })
    expect(mockAddToWaitlist).not.toHaveBeenCalled()
  })

  it('rejects submissions when registration is disabled', async () => {
    mockGetRegistrationMode.mockResolvedValue('disabled')

    const { POST } = await import('./route')
    const response = await POST(
      new NextRequest('http://localhost/api/waitlist', {
        method: 'POST',
        body: JSON.stringify({ email: 'goose@example.com' }),
        headers: { 'Content-Type': 'application/json' },
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: 'Registration is currently disabled.',
    })
    expect(mockAddToWaitlist).not.toHaveBeenCalled()
  })
})
