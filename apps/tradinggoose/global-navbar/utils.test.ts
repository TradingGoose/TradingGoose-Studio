import { describe, expect, it } from 'vitest'
import { createWorkspaceNav, getWorkspaceSwitchPath } from '@/global-navbar/utils'

describe('global navbar utils', () => {
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
})
