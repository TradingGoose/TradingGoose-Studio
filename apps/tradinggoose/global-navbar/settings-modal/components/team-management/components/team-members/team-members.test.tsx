/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ money: vi.fn((_: unknown, value: string) => `USD(${value})`) }))
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }))
vi.mock('@/i18n/formatters', () => ({ formatUsd: mocks.money }))
vi.mock('@/components/ui/avatar', () => {
  const children = ({ children }: any) => children
  return { Avatar: children, AvatarFallback: children, AvatarImage: () => null }
})
vi.mock('@/components/ui/tooltip', () => {
  const children = ({ children }: any) => children
  return {
    Tooltip: children,
    TooltipContent: children,
    TooltipTrigger: ({ render, children }: any) => render ?? children,
  }
})

import { TeamMembers } from './team-members'

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
beforeEach(() => {
  mocks.money.mockClear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
const props = {
  organization: {
    id: 'org',
    name: 'Org',
    slug: 'org',
    createdAt: '',
    members: [{ id: 'member', role: 'member', user: { id: 'user', name: 'User' } }],
  },
  currentUserEmail: 'owner@example.com',
  isAdminOrOwner: true,
  actionsDisabled: false,
  onRemoveMember: vi.fn(),
  onCancelInvitation: vi.fn(),
}
const render = async (amount: unknown) => {
  fetchMock.mockResolvedValue(
    Response.json({
      usageScope: 'individual',
      sharedCurrentPeriodCost: null,
      data: [{ userId: 'user', currentPeriodCost: amount }],
    })
  )
  await act(async () => root.render(createElement(TeamMembers, props)))
}
describe('live member exact-money normalization', () => {
  it('retains exact server amount strings through the actual HTTP consumer', async () => {
    const amount = '9007199254740993.30000000000000001'
    await render(amount)
    expect(mocks.money).toHaveBeenCalledWith('en', amount)
    expect(container.textContent).toContain(`USD(${amount})`)
  })
  it('displays known zero as zero', async () => {
    await render('0')
    expect(mocks.money).toHaveBeenCalledWith('en', '0')
  })
  it.each([null, 0.3])(
    'keeps unavailable/invalid attribution %s unknown rather than zero',
    async (amount) => {
      await render(amount)
      expect(mocks.money).not.toHaveBeenCalled()
      expect(container.textContent).toContain('—')
    }
  )
})
