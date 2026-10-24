import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveActiveTradingServiceId,
  useTradingServices,
} from '@/components/trading-selector/services'

const mockUseOAuthConnections = vi.fn()
const mockUseOAuthProviderAvailability = vi.fn()

vi.mock('@/hooks/queries/oauth-connections', () => ({
  useOAuthConnections: (...args: unknown[]) => mockUseOAuthConnections(...args),
}))

vi.mock('@/hooks/queries/oauth-provider-availability', () => ({
  useOAuthProviderAvailability: (...args: unknown[]) => mockUseOAuthProviderAvailability(...args),
}))

describe('resolveActiveTradingServiceId', () => {
  it('keeps a requested service only when it is connected', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-live', 'alpaca-paper'],
      })
    ).toBe('alpaca-live')
  })

  it('moves from a disconnected requested service to the only connected service', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-paper'],
      })
    ).toBe('alpaca-paper')
  })

  it('requires a user choice when multiple connected services remain', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'alpaca-live',
        connectedServiceIds: ['alpaca-paper', 'alpaca-sandbox'],
      })
    ).toBeUndefined()
  })

  it('does not activate a disconnected single-service provider', () => {
    expect(
      resolveActiveTradingServiceId({
        serviceId: 'tradier-live',
        connectedServiceIds: [],
      })
    ).toBeUndefined()
  })
})

describe('useTradingServices', () => {
  const refetchConnections = vi.fn()
  const refetchAvailability = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseOAuthConnections.mockReturnValue({
      data: [
        { providerId: 'alpaca-live', isConnected: true },
        { providerId: 'alpaca-paper', isConnected: true },
      ],
      isLoading: false,
      error: null,
      refetch: refetchConnections,
    })
  })

  it.each([
    [{ 'alpaca-live': true, 'alpaca-paper': false }, ['alpaca-live'], false],
    [{ 'alpaca-live': false, 'alpaca-paper': false }, [], false],
    [undefined, [], true],
  ] as const)('filters connections by service availability %j', (data, expected, isLoading) => {
    mockUseOAuthProviderAvailability.mockReturnValue({
      data,
      isLoading,
      error: null,
      refetch: refetchAvailability,
    })
    expect(useTradingServices({ providerId: 'alpaca', serviceId: 'alpaca-paper' })).toMatchObject({
      serviceIds: expected,
      connectedServiceIds: expected,
      activeServiceId: expected[0],
      isLoading,
      error: null,
    })
  })

  it('reports availability failures and refreshes both availability and connections', () => {
    const error = new Error('availability failed')
    mockUseOAuthProviderAvailability.mockReturnValue({
      data: undefined,
      isLoading: false,
      error,
      refetch: refetchAvailability,
    })
    const services = useTradingServices({ providerId: 'alpaca', serviceId: 'alpaca-paper' })
    expect(services.error).toBe(error)
    expect(services.activeServiceId).toBeUndefined()
    services.refetch()
    expect(refetchAvailability).toHaveBeenCalledOnce()
    expect(refetchConnections).toHaveBeenCalledOnce()
  })
})
