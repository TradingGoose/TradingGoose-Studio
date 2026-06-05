import { ScrollText } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import {
  createWorkspaceNav,
  getAdminNavState,
  getWorkspaceNavState,
  getWorkspaceSwitchPath,
} from '@/global-navbar/utils'

const workspaceNavLabels = {
  workspace: {
    dashboard: 'Dashboard',
    knowledge: 'Knowledge',
    files: 'Files',
    records: 'Records',
    monitor: 'Monitor',
  },
  more: {
    environment: 'Environment',
    apiKeys: 'API Keys',
    integrations: 'Integrations',
  },
}

describe('global navbar utils', () => {
  it('builds workspace switch paths from typed sections', () => {
    expect(getWorkspaceSwitchPath('ws-2', 'records', 'tab=logs')).toBe(
      '/workspace/ws-2/records?tab=logs'
    )
    expect(getWorkspaceSwitchPath('ws-2', null)).toBe('/workspace/ws-2/dashboard')
  })

  it('derives nav state from app router segments', () => {
    expect(getWorkspaceNavState(['ws-1', 'files'])).toEqual({
      workspaceId: 'ws-1',
      activeKey: 'files',
    })
    expect(getWorkspaceNavState(['ws-1', 'w', 'workflow-1'])).toEqual({
      workspaceId: 'ws-1',
      activeKey: 'dashboard',
    })
    expect(getAdminNavState([])).toEqual({ activeKey: 'overview' })
    expect(getAdminNavState(['billing'])).toEqual({ activeKey: 'billing' })
  })

  it('adds monitor to the workspace navigation', () => {
    expect(createWorkspaceNav(workspaceNavLabels, 'ws-1').map((item) => item.url)).toContain(
      '/workspace/ws-1/monitor'
    )
  })

  it('adds records to the workspace navigation', () => {
    const recordsItem = createWorkspaceNav(workspaceNavLabels, 'ws-1').find(
      (item) => item.title === 'Records'
    )

    expect(recordsItem?.url).toBe('/workspace/ws-1/records')
    expect(recordsItem?.icon).toBe(ScrollText)
  })

  it('does not expose removed records or logs routes without a workspace id', () => {
    expect(createWorkspaceNav(workspaceNavLabels)).toEqual([])
  })
})
