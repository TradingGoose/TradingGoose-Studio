import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  gate: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  values: vi.fn(),
}))
vi.mock('@tradinggoose/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.select }) }) }),
    update: () => ({ set: mocks.set }),
    insert: () => ({ values: mocks.values }),
  },
}))
vi.mock('@tradinggoose/db/schema', () => ({ systemBillingSettings: { id: 'id' } }))
vi.mock('drizzle-orm', () => ({ eq: (left: unknown, right: unknown) => ({ left, right }) }))
vi.mock('@/lib/admin/billing/authorization', () => ({ requireAdminBillingUserId: mocks.admin }))
vi.mock('@/lib/billing/settings', () => ({
  ADMIN_BILLING_UNAVAILABLE_ERROR: 'Billing unavailable',
  GLOBAL_BILLING_SETTINGS_ID: 'global',
  getBillingGateState: mocks.gate,
}))

import { PATCH } from './route'

const payload = {
  onboardingAllowanceUsd: '0.30000000000000001',
  overageThresholdDollars: '9007199254740993.01',
  workflowExecutionChargeUsd: '0.000000000000000000000000000001',
  functionExecutionChargeUsd: '1.0000000000000000001',
  usageWarningThresholdPercent: 80,
  freeTierUpgradeThresholdPercent: 90,
  enterpriseContactUrl: null,
}
const request = (body: unknown) =>
  new Request('http://localhost/api/admin/billing/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.admin.mockResolvedValue('admin')
  mocks.gate.mockResolvedValue({ stripeConfigured: true })
  mocks.select.mockResolvedValue([{ id: 'global' }])
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockResolvedValue(undefined)
  mocks.values.mockResolvedValue(undefined)
})
describe('admin exact settings persistence', () => {
  it.each(['update', 'insert'])('retains all exact amount strings on %s', async (mode) => {
    if (mode === 'insert') mocks.select.mockResolvedValue([])
    expect((await PATCH(request(payload))).status).toBe(200)
    expect(mode === 'insert' ? mocks.values : mocks.set).toHaveBeenCalledWith(
      expect.objectContaining(payload)
    )
  })
  it.each([0, 0.3, '-1', 'NaN', 'Infinity', '1e-16384'])(
    'refuses numeric/invalid monetary payload %s before persistence',
    async (value) => {
      expect((await PATCH(request({ ...payload, workflowExecutionChargeUsd: value }))).status).toBe(
        400
      )
      expect(mocks.select).not.toHaveBeenCalled()
      expect(mocks.set).not.toHaveBeenCalled()
      expect(mocks.values).not.toHaveBeenCalled()
    }
  )
  it.each([
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
  ] as const)('preserves %s gate', async (error, status) => {
    mocks.admin.mockRejectedValue(new Error(error))
    expect((await PATCH(request(payload))).status).toBe(status)
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('preserves unavailable Stripe gate', async () => {
    mocks.gate.mockResolvedValue({ stripeConfigured: false })
    expect((await PATCH(request(payload))).status).toBe(409)
    expect(mocks.select).not.toHaveBeenCalled()
  })
})
