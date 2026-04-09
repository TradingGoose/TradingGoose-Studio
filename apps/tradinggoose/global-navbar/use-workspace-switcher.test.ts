import { describe, expect, it } from 'vitest'
import { shouldResetWorkflowRegistryOnWorkspaceSwitch } from '@/global-navbar/use-workspace-switcher'

describe('shouldResetWorkflowRegistryOnWorkspaceSwitch', () => {
  it('returns false outside workspace-scoped routes', () => {
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/admin')).toBe(false)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/admin/integrations')).toBe(false)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/login')).toBe(false)
  })

  it('returns true inside workspace-scoped routes', () => {
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/workspace/ws-1/dashboard')).toBe(true)
    expect(shouldResetWorkflowRegistryOnWorkspaceSwitch('/workspace/ws-1/w/wf-1')).toBe(true)
  })
})
