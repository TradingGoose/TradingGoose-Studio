import { ScrollText } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { createWorkspaceNav, getWorkspaceSwitchPath } from '@/global-navbar/utils'

describe('global navbar utils', () => {
  it('keeps the records section when switching workspaces', () => {
    expect(getWorkspaceSwitchPath('/workspace/ws-1/records', 'ws-2', 'tab=logs')).toBe(
      '/workspace/ws-2/records?tab=logs'
    )
  })

  it('keeps the monitor section when switching workspaces', () => {
    expect(getWorkspaceSwitchPath('/workspace/ws-1/monitor', 'ws-2')).toBe(
      '/workspace/ws-2/monitor'
    )
    expect(getWorkspaceSwitchPath('/workspace/ws-1/monitor', 'ws-2', 'layout=roadmap')).toBe(
      '/workspace/ws-2/monitor?layout=roadmap'
    )
  })

  it('adds monitor to the workspace navigation', () => {
    expect(createWorkspaceNav('ws-1').map((item) => item.url)).toContain('/workspace/ws-1/monitor')
  })

  it('adds records to the workspace navigation', () => {
    const recordsItem = createWorkspaceNav('ws-1').find((item) => item.title === 'Records')

    expect(recordsItem?.url).toBe('/workspace/ws-1/records')
    expect(recordsItem?.icon).toBe(ScrollText)
  })

  it('does not expose removed records or logs routes without a workspace id', () => {
    const urls = createWorkspaceNav().map((item) => item.url)

    expect(urls).not.toContain('/records')
    expect(urls).not.toContain('/logs')
  })
})
