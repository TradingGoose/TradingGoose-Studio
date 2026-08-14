import { describe, expect, it } from 'vitest'
import {
  buildCopilotWorkspaceChannelId,
  parseCopilotWorkspaceChannelId,
} from '@/stores/copilot/channel-id'

describe('Copilot workspace channel identity', () => {
  it('round-trips authenticated user and workspace IDs without delimiter collisions', () => {
    const identity = {
      authenticatedUserId: 'user:workspace:/one',
      workspaceId: 'workspace:user:/two',
    }

    expect(parseCopilotWorkspaceChannelId(buildCopilotWorkspaceChannelId(identity))).toEqual(
      identity
    )
  })

  it('isolates two authenticated users in the same workspace', () => {
    const workspaceId = 'shared-workspace'

    expect(buildCopilotWorkspaceChannelId({ authenticatedUserId: 'user-a', workspaceId })).not.toBe(
      buildCopilotWorkspaceChannelId({ authenticatedUserId: 'user-b', workspaceId })
    )
  })

  it('rejects incomplete workspace identities', () => {
    expect(() =>
      buildCopilotWorkspaceChannelId({ authenticatedUserId: '', workspaceId: 'workspace-1' })
    ).toThrow('authenticated user and workspace IDs')
    expect(parseCopilotWorkspaceChannelId('pair-blue')).toBeNull()
  })
})
