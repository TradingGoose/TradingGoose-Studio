/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthenticateIndicatorRequest,
  mockCheckWorkspacePermission,
  mockListIndicators,
  mockIsIndicatorTriggerCapable,
} = vi.hoisted(() => ({
  mockAuthenticateIndicatorRequest: vi.fn(),
  mockCheckWorkspacePermission: vi.fn(),
  mockListIndicators: vi.fn(),
  mockIsIndicatorTriggerCapable: vi.fn(),
}))

vi.mock('@/lib/indicators/custom/operations', () => ({
  listIndicators: (...args: unknown[]) => mockListIndicators(...args),
}))

vi.mock('@/lib/indicators/default/runtime', () => ({
  DEFAULT_INDICATOR_RUNTIME_ENTRIES: [
    {
      id: 'default-trigger',
      name: 'Default Trigger',
      pineCode: 'trigger-capable',
      inputMeta: {
        Length: { title: 'Length', type: 'int', defval: 14 },
      },
    },
    {
      id: 'default-study',
      name: 'Default Study',
      pineCode: 'study-only',
      inputMeta: {
        Window: { title: 'Window', type: 'int', defval: 20 },
      },
    },
  ],
}))

vi.mock('@/lib/indicators/trigger-detection', () => ({
  isIndicatorTriggerCapable: (...args: unknown[]) => mockIsIndicatorTriggerCapable(...args),
}))

vi.mock('../utils', () => ({
  authenticateIndicatorRequest: (...args: unknown[]) => mockAuthenticateIndicatorRequest(...args),
  checkWorkspacePermission: (...args: unknown[]) => mockCheckWorkspacePermission(...args),
}))

describe('indicator options route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthenticateIndicatorRequest.mockResolvedValue({
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckWorkspacePermission.mockResolvedValue({ ok: true, permission: 'admin' })
    mockIsIndicatorTriggerCapable.mockImplementation((code: string) => code === 'trigger-capable')
    mockListIndicators.mockResolvedValue([
      {
        id: 'custom-trigger',
        name: 'Custom Trigger',
        color: '',
        pineCode: 'trigger-capable',
        inputMeta: {
          Threshold: { title: 'Threshold', type: 'float', defval: 2.5 },
        },
      },
      {
        id: 'custom-study',
        name: 'Custom Study',
        color: '#123456',
        pineCode: 'study-only',
        inputMeta: {
          Window: { title: 'Window', type: 'int', defval: 20 },
        },
      },
      {
        id: 'custom-without-inputs',
        name: 'Custom Without Inputs',
        color: '#654321',
        pineCode: 'trigger-capable',
        inputMeta: undefined,
      },
    ])
  })

  const getOptions = async (search: string) => {
    const { GET } = await import('./route')
    return GET(new NextRequest(`http://localhost/api/indicators/options${search}`))
  }

  it('returns monitor-surface trigger-capable options with derived input metadata', async () => {
    const response = await getOptions('?workspaceId=workspace-1&surface=monitor')
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.map((entry: any) => entry.id).sort()).toEqual([
      'custom-trigger',
      'custom-without-inputs',
      'default-trigger',
    ])

    const defaultOption = payload.data.find((entry: any) => entry.id === 'default-trigger')
    expect(defaultOption).toEqual(
      expect.objectContaining({
        inputTitles: ['Length'],
        inputMeta: { Length: { title: 'Length', type: 'int', defval: 14 } },
      })
    )

    const customOption = payload.data.find((entry: any) => entry.id === 'custom-trigger')
    expect(customOption).toEqual(
      expect.objectContaining({
        color: '#3972F6',
        inputTitles: ['Threshold'],
        inputMeta: { Threshold: { title: 'Threshold', type: 'float', defval: 2.5 } },
      })
    )

    const optionWithoutInputs = payload.data.find(
      (entry: any) => entry.id === 'custom-without-inputs'
    )
    expect(optionWithoutInputs.inputTitles).toEqual([])
    expect(optionWithoutInputs.inputMeta).toBeUndefined()
  })

  it('keeps copilot surface broader than monitor surface', async () => {
    const response = await getOptions('?workspaceId=workspace-1&surface=copilot')
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.map((entry: any) => entry.id).sort()).toEqual([
      'custom-study',
      'custom-trigger',
      'custom-without-inputs',
      'default-study',
      'default-trigger',
    ])
  })
})
