import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INDICATOR_DOCUMENT_FORMAT,
  MCP_SERVER_DOCUMENT_FORMAT,
  normalizeEntityFields,
  SKILL_DOCUMENT_FORMAT,
  WATCHLIST_DOCUMENT_FORMAT,
} from '@/lib/copilot/entity-documents'
import { hashServerToolReviewBase } from '@/lib/copilot/tools/server/base-tool'
import {
  buildDocumentEnvelope,
  buildReviewDocumentDiff,
  buildSavedEntityListInfo,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
} from './shared'

const { mockApplySavedEntityState } = vi.hoisted(() => ({
  mockApplySavedEntityState: vi.fn(),
}))
const mockCheckWorkspaceAccess = vi.hoisted(() => vi.fn())
const mockReadBootstrappedSavedEntityFields = vi.hoisted(() => vi.fn())
const mockReadEntityListMembersFromDb = vi.hoisted(() => vi.fn())
const mockVerifyReviewTargetAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => mockCheckWorkspaceAccess(...args),
}))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: (...args: unknown[]) => mockVerifyReviewTargetAccess(...args),
}))

vi.mock('@/lib/yjs/server/apply-entity-state', () => ({
  applySavedEntityState: (...args: unknown[]) => mockApplySavedEntityState(...args),
}))

vi.mock('@/lib/yjs/server/bootstrap-review-target', () => ({
  readBootstrappedSavedEntityFields: (...args: unknown[]) =>
    mockReadBootstrappedSavedEntityFields(...args),
}))

vi.mock('@/lib/yjs/server/entity-loaders', () => ({
  readEntityListMembersFromDb: (...args: unknown[]) => mockReadEntityListMembersFromDb(...args),
}))

describe('entity document mutation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplySavedEntityState.mockImplementation(async (_kind, _entityId, fields) => fields)
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
    })
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mockReadEntityListMembersFromDb.mockResolvedValue([])
  })

  it('builds server list entries from canonical DB membership', async () => {
    mockReadEntityListMembersFromDb.mockResolvedValueOnce([
      {
        id: 'skill-1',
        name: 'Skill 1',
        description: 'Use Skill 1 for summaries.',
        color: '#10b981',
      },
    ])

    await expect(buildSavedEntityListInfo('skill', 'workspace-1')).resolves.toEqual([
      {
        entityId: 'skill-1',
        entityName: 'Skill 1',
        entityDescription: 'Use Skill 1 for summaries.',
        color: '#10b981',
      },
    ])
    expect(mockReadEntityListMembersFromDb).toHaveBeenCalledWith('skill', 'workspace-1')
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
    expect(mockApplySavedEntityState).toHaveBeenCalledWith('skill', 'skill-1', {
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

    expect(mockApplySavedEntityState).toHaveBeenCalledWith('skill', 'skill-1', nextFields)
  })

  it('keeps indicator input metadata out of Copilot document updates', async () => {
    const pineCode = `
const mode = input.enum('fast', 'Mode', ['fast', 'slow'])
const length = input.int(14, 'Length', 1, 50, 1)
`

    await executeUpdateEntityDocumentMutation(
      'indicator',
      'edit_indicator',
      {
        entityId: 'indicator-1',
        documentFormat: INDICATOR_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          name: 'Updated Indicator',
          color: '#10b981',
          pineCode,
          inputMeta: {
            Stale: { title: 'Stale', type: 'string', defval: 'old' },
          },
        }),
      },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(mockApplySavedEntityState).toHaveBeenCalledWith('indicator', 'indicator-1', {
      name: 'Updated Indicator',
      color: '#10b981',
      pineCode,
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

  it('allows disabled MCP server drafts without a URL', () => {
    expect(
      normalizeEntityFields('mcp_server', {
        name: 'Draft MCP',
        description: '',
        transport: 'streamable-http',
        url: '',
        headers: {},
        command: '',
        args: [],
        env: {},
        timeout: 30000,
        retries: 3,
        enabled: false,
      })
    ).toMatchObject({ name: 'Draft MCP', url: '', enabled: false })
  })

  it('rejects MCP server edit documents without a URL before persisting state', async () => {
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

    expect(mockApplySavedEntityState).not.toHaveBeenCalled()
  })

  it('rejects partial watchlist edit documents before persisting state', async () => {
    await expect(
      executeUpdateEntityDocumentMutation(
        'watchlist',
        'edit_watchlist',
        {
          entityId: 'watchlist-1',
          documentFormat: WATCHLIST_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
            name: 'Only Name',
          }),
        },
        { userId: 'user-1', accessLevel: 'full' }
      )
    ).rejects.toThrow(/settings/i)

    expect(mockApplySavedEntityState).not.toHaveBeenCalled()
  })

  it('drops blank MCP server header rows before persisting state', async () => {
    await executeUpdateEntityDocumentMutation(
      'mcp_server',
      'edit_mcp_server',
      {
        entityId: 'mcp-1',
        documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          name: 'Header MCP',
          description: '',
          transport: 'streamable-http',
          url: 'https://mcp.example.test',
          headers: { '': '', Authorization: ' Bearer token ' },
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

    expect(mockApplySavedEntityState).toHaveBeenCalledWith(
      'mcp_server',
      'mcp-1',
      expect.objectContaining({ headers: { Authorization: 'Bearer token' } })
    )
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
