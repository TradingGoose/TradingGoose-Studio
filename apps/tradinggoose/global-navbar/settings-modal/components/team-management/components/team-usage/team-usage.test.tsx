import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ data: undefined as any, header: vi.fn() }))
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }))
vi.mock('@/lib/auth-client', () => ({ useActiveOrganization: () => ({ data: { id: 'org' } }) }))
vi.mock('@/hooks/queries/organization', () => ({
  useOrganizationBilling: () => ({ data: mocks.data, isLoading: false, error: null }),
}))
vi.mock('@/global-navbar/settings-modal/components/shared/usage-header', () => ({
  UsageHeader: (props: unknown) => {
    mocks.header(props)
    return null
  },
}))
vi.mock('@/global-navbar/settings-modal/components/subscription/components', () => ({
  UsageLimit: () => null,
}))

import { TeamUsage } from './team-usage'

beforeEach(() => {
  mocks.header.mockClear()
  mocks.data = {
    totalCurrentUsage: '0.99999999999999999',
    totalUsageLimit: '1',
    minimumUsageLimit: '0.3',
    isWarning: false,
    isExceeded: false,
    subscriptionTier: null,
  }
})
describe('team monetary usage projection', () => {
  it('uses exact server status even when the display-only percentage rounds to100', () => {
    renderToStaticMarkup(createElement(TeamUsage, { isOrganizationOwner: true }))
    expect(mocks.header).toHaveBeenCalledWith(
      expect.objectContaining({
        current: '0.99999999999999999',
        limit: '1',
        progressValue: 100,
        status: 'ok',
      })
    )
  })
  it('preserves unlimited null and exact server flags without substituting a minimum cap', () => {
    mocks.data = { ...mocks.data, totalUsageLimit: null, isWarning: true }
    renderToStaticMarkup(createElement(TeamUsage, { isOrganizationOwner: true }))
    expect(mocks.header).toHaveBeenCalledWith(
      expect.objectContaining({ limit: null, status: 'warning', progressValue: 0 })
    )
  })
  it('refuses missing server status instead of fabricating an ok state', () => {
    Reflect.deleteProperty(mocks.data, 'isExceeded')
    expect(renderToStaticMarkup(createElement(TeamUsage, { isOrganizationOwner: true }))).toContain(
      'errors.loadBillingData'
    )
    expect(mocks.header).not.toHaveBeenCalled()
  })
})
