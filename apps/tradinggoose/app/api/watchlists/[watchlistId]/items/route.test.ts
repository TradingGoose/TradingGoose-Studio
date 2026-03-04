/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockAddListingToWatchlist = vi.fn()
const mockAddSectionToWatchlist = vi.fn()
const mockRenameWatchlistSection = vi.fn()
const mockRemoveWatchlistItem = vi.fn()
const mockRemoveWatchlistSection = vi.fn()

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/permissions/utils', () => ({
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))

vi.mock('@/lib/watchlists/operations', async () => {
  const actual = await vi.importActual<any>('@/lib/watchlists/operations')
  return {
    ...actual,
    addListingToWatchlist: mockAddListingToWatchlist,
    addSectionToWatchlist: mockAddSectionToWatchlist,
    renameWatchlistSection: mockRenameWatchlistSection,
    removeWatchlistItem: mockRemoveWatchlistItem,
    removeWatchlistSection: mockRemoveWatchlistSection,
  }
})

describe('Watchlist items API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetUserEntityPermissions.mockResolvedValue('admin')
  })

  it('adds a listing through POST action addListing', async () => {
    mockAddListingToWatchlist.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Default',
      isSystem: true,
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { POST } = await import('@/app/api/watchlists/[watchlistId]/items/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      action: 'addListing',
      listing: {
        listing_id: 'aapl-id',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockAddListingToWatchlist).toHaveBeenCalled()
  })

  it('removes an item through POST action removeItem', async () => {
    mockRemoveWatchlistItem.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Default',
      isSystem: true,
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { POST } = await import('@/app/api/watchlists/[watchlistId]/items/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      action: 'removeItem',
      itemId: 'item-1',
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockRemoveWatchlistItem).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'watchlist-1',
      'item-1'
    )
  })

  it('removes a section through POST action removeSection', async () => {
    mockRemoveWatchlistSection.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Default',
      isSystem: true,
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { POST } = await import('@/app/api/watchlists/[watchlistId]/items/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      action: 'removeSection',
      sectionId: 'section-1',
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockRemoveWatchlistSection).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'watchlist-1',
      'section-1'
    )
  })

  it('renames a section through POST action renameSection', async () => {
    mockRenameWatchlistSection.mockResolvedValue({
      id: 'watchlist-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      name: 'Default',
      isSystem: true,
      items: [],
      settings: { showLogo: true, showTicker: true, showDescription: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const { POST } = await import('@/app/api/watchlists/[watchlistId]/items/route')
    const request = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      action: 'renameSection',
      sectionId: 'section-1',
      label: 'Renamed Section',
    })

    const response = await POST(request, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockRenameWatchlistSection).toHaveBeenCalledWith(
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'watchlist-1',
      'section-1',
      'Renamed Section'
    )
  })

  it('requires sectionId and label for POST action renameSection', async () => {
    const { POST } = await import('@/app/api/watchlists/[watchlistId]/items/route')
    const missingSectionIdRequest = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      action: 'renameSection',
      label: 'Renamed Section',
    })
    const missingSectionIdResponse = await POST(missingSectionIdRequest, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })

    expect(missingSectionIdResponse.status).toBe(400)

    const missingLabelRequest = createMockRequest('POST', {
      workspaceId: 'workspace-1',
      action: 'renameSection',
      sectionId: 'section-1',
    })
    const missingLabelResponse = await POST(missingLabelRequest, {
      params: Promise.resolve({ watchlistId: 'watchlist-1' }),
    })

    expect(missingLabelResponse.status).toBe(400)
  })
})
