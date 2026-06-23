import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  SKILL_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import { hashServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import {
  buildDocumentEnvelope,
  buildReviewDocumentDiff,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
} from './shared'

const { mockApplyEntityStateInSocketServer } = vi.hoisted(() => ({
  mockApplyEntityStateInSocketServer: vi.fn(),
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

vi.mock('@/lib/yjs/server/snapshot-bridge', () => ({
  applyEntityStateInSocketServer: (...args: unknown[]) =>
    mockApplyEntityStateInSocketServer(...args),
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
    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('skill-1', 'skill', {
      name: 'Updated Skill',
      description: 'Updated description',
      content: 'Use the updated process.',
    })
    expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
  })

  it('applies accepted reviewed updates to Yjs after verifying the reviewed base', async () => {
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

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith(
      'skill-1',
      'skill',
      nextFields
    )
  })

  it('preserves indicator input metadata when applying document updates', async () => {
    const inputMeta = {
      Mode: {
        title: 'Mode',
        type: 'string',
        defval: 'fast',
        options: ['fast', 'slow'],
        value: 'slow',
      },
    }

    await executeUpdateEntityDocumentMutation(
      'indicator',
      'edit_indicator',
      {
        entityId: 'indicator-1',
        documentFormat: INDICATOR_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          name: 'Updated Indicator',
          pineCode: "const mode = input.string('fast', 'Mode')",
          inputMeta,
        }),
      },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(mockApplyEntityStateInSocketServer).toHaveBeenCalledWith('indicator-1', 'indicator', {
      name: 'Updated Indicator',
      pineCode: "const mode = input.string('fast', 'Mode')",
      inputMeta,
    })
  })

  it('rejects MCP server create documents without a URL', async () => {
    const create = vi.fn()

    await expect(
      executeCreateEntityDocumentMutation(
        'mcp_server',
        {
          workspaceId: 'workspace-1',
          documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
            name: 'Missing URL MCP',
            description: '',
            transport: 'http',
            url: '',
            headers: {},
            command: '',
            args: [],
            env: {},
            timeout: 30000,
            retries: 3,
            enabled: true,
          }),
        },
        { userId: 'user-1', accessLevel: 'full' },
        create
      )
    ).rejects.toThrow('Invalid MCP server URL: URL is required and must be a string')

    expect(create).not.toHaveBeenCalled()
  })

  it('rejects MCP server edit documents without a URL before applying Yjs state', async () => {
    await expect(
      executeUpdateEntityDocumentMutation(
        'mcp_server',
        'edit_mcp_server',
        {
          entityId: 'mcp-1',
          documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
            name: 'Missing URL MCP',
            description: '',
            transport: 'streamable-http',
            url: '   ',
            headers: {},
            command: '',
            args: [],
            env: {},
            timeout: 30000,
            retries: 3,
            enabled: true,
          }),
        },
        { userId: 'user-1', accessLevel: 'full' }
      )
    ).rejects.toThrow('Invalid MCP server URL: URL is required and must be a string')

    expect(mockApplyEntityStateInSocketServer).not.toHaveBeenCalled()
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

  it('redacts MCP server secret values in Copilot documents', async () => {
    const readEnvelope = buildDocumentEnvelope('mcp_server', 'mcp-1', {
      name: 'Private MCP',
      description: 'Uses auth',
      transport: 'http',
      url: 'https://mcp.example.test',
      headers: { Authorization: 'Bearer read-secret' },
      command: '',
      args: [],
      env: { API_KEY: 'read-secret-env' },
      timeout: 30000,
      retries: 3,
      enabled: true,
    })
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

    expect(readEnvelope.entityDocument).toContain('[redacted]')
    expect(readEnvelope.entityDocument).not.toContain('read-secret')
    expect(readEnvelope.entityDocument).not.toContain('read-secret-env')
    expect(after).toContain('[redacted]')
    expect(after).not.toContain('secret-token')
    expect(after).not.toContain('secret-env')
    expect(diff.before).not.toContain('old-secret')
    expect(diff.after).not.toContain('secret-token')
  })
})
