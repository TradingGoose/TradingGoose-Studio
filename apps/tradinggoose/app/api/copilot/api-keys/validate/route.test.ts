/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Copilot API Key Validate Route', () => {
  const mockGetPersonalBillingSnapshot = vi.fn()
  const mockCheckInternalApiKey = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    mockGetPersonalBillingSnapshot.mockReset()
    mockCheckInternalApiKey.mockReset()

    mockCheckInternalApiKey.mockReturnValue({ success: true })

    vi.doMock('@/lib/billing/core/subscription', () => ({
      getPersonalBillingSnapshot: (...args: any[]) => mockGetPersonalBillingSnapshot(...args),
    }))

    vi.doMock('@/lib/copilot/utils', () => ({
      checkInternalApiKey: (...args: any[]) => mockCheckInternalApiKey(...args),
    }))

    vi.doMock('@/lib/logs/console/logger', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    }))
  })

  it('returns an allowed usage snapshot when the user is within limit', async () => {
    mockGetPersonalBillingSnapshot.mockResolvedValue({
      currentPeriodCost: 12.5,
      limit: 100,
      isExceeded: false,
    })

    const request = new NextRequest('http://localhost:3000/api/copilot/api-keys/validate', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/api-keys/validate/route')
    const response = await POST(request)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      allowed: true,
      isExceeded: false,
      currentUsage: 12.5,
      limit: 100,
      remaining: 87.5,
    })
  })

  it('returns the same snapshot fields when the usage limit is exceeded', async () => {
    mockGetPersonalBillingSnapshot.mockResolvedValue({
      currentPeriodCost: 125,
      limit: 100,
      isExceeded: true,
    })

    const request = new NextRequest('http://localhost:3000/api/copilot/api-keys/validate', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/api-keys/validate/route')
    const response = await POST(request)

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({
      allowed: false,
      isExceeded: true,
      currentUsage: 125,
      limit: 100,
      remaining: 0,
    })
  })

  it('rejects requests without internal auth', async () => {
    mockCheckInternalApiKey.mockReturnValue({ success: false, error: 'Invalid API key' })

    const request = new NextRequest('http://localhost:3000/api/copilot/api-keys/validate', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user-1' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const { POST } = await import('@/app/api/copilot/api-keys/validate/route')
    const response = await POST(request)

    expect(response.status).toBe(401)
  })
})
