import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_SERVER_DOCUMENT_FORMAT, SKILL_DOCUMENT_FORMAT } from '@/lib/copilot/entity-documents'
import { hashServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import {
  buildReviewDocumentDiff,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
} from './shared'

const { mockApplySavedEntityPersistedState } = vi.hoisted(() => ({
  mockApplySavedEntityPersistedState: vi.fn(),
}))
const mockCheckWorkspaceAccess = vi.hoisted(() => vi.fn())
const mockReadBootstrappedSavedEntityFields = vi.hoisted(() => vi.fn())
const mockVerifyReviewTargetAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: (...args: unknown[]) => mockVerifyReviewTargetAccess(...args),
}))

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  applySavedEntityPersistedState: (...args: unknown[]) =>
    mockApplySavedEntityPersistedState(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedSavedEntityFields: (...args: unknown[]) =>
    mockReadBootstrappedSavedEntityFields(...args),
}))

describe('entity document mutation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
    })
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
  })

  it('applies full-access updates without building a review preview', async () => {
    const result = await executeUpdateEntityDocumentMutation(
      'skill',
      'edit_skill',
      {
        entityId: 'skill-1',
        documentFormat: SKILL_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          name: 'Updated Skill',
          description: 'Updated description',
          content: 'Use the updated process.',
        }),
      },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(result).toMatchObject({
      success: true,
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityId: 'skill-1',
      entityName: 'Updated Skill',
      documentFormat: SKILL_DOCUMENT_FORMAT,
    })
    expect(result).not.toHaveProperty('requiresReview')
    expect(result).not.toHaveProperty('preview')
    expect(mockApplySavedEntityPersistedState).toHaveBeenCalledWith('skill', 'skill-1', {
      name: 'Updated Skill',
      description: 'Updated description',
      content: 'Use the updated process.',
    })
    expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
  })

  it('persists accepted reviewed updates after verifying the reviewed base', async () => {
    const currentFields = {
      name: 'Existing Skill',
      description: 'Existing description',
      content: 'Use the existing process.',
    }
    const nextFields = {
      name: 'Updated Skill',
      description: 'Updated description',
      content: 'Use the updated process.',
    }
    mockReadBootstrappedSavedEntityFields.mockResolvedValue(currentFields)

    await executeUpdateEntityDocumentMutation(
      'skill',
      'edit_skill',
      {
        entityId: 'skill-1',
        documentFormat: SKILL_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify(nextFields),
      },
      {
        userId: 'user-1',
        accessLevel: 'full',
        acceptedReviewBaseStateHash: hashServerToolReviewBase(currentFields),
      }
    )

    expect(mockApplySavedEntityPersistedState).toHaveBeenCalledWith('skill', 'skill-1', nextFields)
  })

  it('keeps Studio create mutations in review mode', async () => {
    const result = await executeCreateEntityDocumentMutation(
      'skill',
      {
        workspaceId: 'workspace-1',
        documentFormat: SKILL_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          name: 'New Skill',
          description: 'New description',
          content: 'Use the new process.',
        }),
      },
      { userId: 'user-1', accessLevel: 'limited' },
      vi.fn()
    )

    expect(result).toMatchObject({
      requiresReview: true,
      success: true,
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityName: 'New Skill',
      documentFormat: SKILL_DOCUMENT_FORMAT,
    })
    expect('preview' in result ? result.preview.documentDiff.before : undefined).toBe('')
    expect('preview' in result ? result.preview.documentDiff.after : undefined).toContain(
      'New Skill'
    )
  })

  it('redacts MCP server secret values in review documents', async () => {
    const result = await executeCreateEntityDocumentMutation(
      'mcp_server',
      {
        workspaceId: 'workspace-1',
        documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          name: 'Private MCP',
          description: 'Uses auth',
          transport: 'http',
          url: 'https://mcp.example.test',
          headers: { Authorization: 'Bearer secret-token' },
          command: '',
          args: [],
          env: { API_KEY: 'secret-env' },
          timeout: 30000,
          retries: 3,
          enabled: true,
        }),
      },
      { userId: 'user-1', accessLevel: 'limited' },
      vi.fn()
    )
    const after = 'preview' in result ? result.preview.documentDiff.after : ''
    const diff = buildReviewDocumentDiff(
      'mcp_server',
      {
        name: 'Private MCP',
        description: 'Uses old auth',
        transport: 'http',
        url: 'https://mcp.example.test',
        headers: { Authorization: 'Bearer old-secret' },
        command: '',
        args: [],
        env: { API_KEY: 'old-secret-env' },
        timeout: 30000,
        retries: 3,
        enabled: true,
      },
      JSON.parse(after)
    )

    expect(after).toContain('[redacted]')
    expect(after).not.toContain('secret-token')
    expect(after).not.toContain('secret-env')
    expect(diff.before).not.toContain('old-secret')
    expect(diff.after).not.toContain('secret-token')
  })
})
