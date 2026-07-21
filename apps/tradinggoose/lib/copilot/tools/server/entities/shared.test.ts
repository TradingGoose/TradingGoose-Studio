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
  type EntityCreateContext,
  executeCreateEntityDocumentMutation,
  executeRenameEntityMutation,
  executeUpdateEntityDocumentMutation,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

const { mockApplySavedEntityState, mockRenameSavedEntityIdentity } = vi.hoisted(() => ({
  mockApplySavedEntityState: vi.fn(),
  mockRenameSavedEntityIdentity: vi.fn(),
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

vi.mock('@/lib/saved-entities/identity', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  renameSavedEntityIdentity: (...args: unknown[]) => mockRenameSavedEntityIdentity(...args),
}))

describe('entity document mutation helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplySavedEntityState.mockImplementation(async (...args: unknown[]) => args[4])
    mockRenameSavedEntityIdentity.mockResolvedValue({
      name: 'Renamed',
      updatedAt: new Date('2026-07-11T12:00:00.000Z'),
    })
    mockReadBootstrappedSavedEntityFields.mockResolvedValue({
      description: 'Existing description',
      content: 'Existing content',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'workspace-1', allowPersonalApiKeys: true },
    })
    mockVerifyReviewTargetAccess.mockResolvedValue({
      hasAccess: true,
      workspaceId: 'workspace-1',
    })
    mockReadEntityListMembersFromDb.mockImplementation(async (kind: string) => {
      const members: Record<string, { id: string; name: string }> = {
        skill: { id: 'skill-1', name: 'Existing Skill' },
        indicator: { id: 'indicator-1', name: 'Existing Indicator' },
        mcp_server: { id: 'mcp-1', name: 'Existing MCP' },
        watchlist: { id: 'watchlist-1', name: 'Existing Watchlist' },
      }
      return members[kind] ? [members[kind]] : []
    })
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

  it('returns the canonical structured workspace and entity authorization denials', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'workspace-1', allowPersonalApiKeys: false },
    })

    await expect(
      verifyWorkspaceContext(
        { userId: 'user-1', workspaceId: 'workspace-1', apiKeyType: 'personal' },
        'read'
      )
    ).rejects.toMatchObject({ status: 403, code: 'personal_api_keys_disabled' })

    mockCheckWorkspaceAccess
      .mockResolvedValueOnce({ exists: false, hasAccess: false, canWrite: false })
      .mockResolvedValueOnce({ exists: true, hasAccess: true, canWrite: false })
    mockVerifyReviewTargetAccess.mockResolvedValueOnce({ hasAccess: false, workspaceId: null })
    for (const denial of [
      verifyWorkspaceContext({ userId: 'user-1', workspaceId: 'workspace-1' }, 'read'),
      verifyWorkspaceContext({ userId: 'user-1', workspaceId: 'workspace-1' }, 'write'),
      verifySavedEntityContext(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        'skill',
        'skill-1',
        'read'
      ),
    ]) {
      await expect(denial).rejects.toMatchObject({ status: 403, code: 'access_denied' })
    }
  })

  it('applies full-access updates without building a review preview', async () => {
    const result = await executeUpdateEntityDocumentMutation(
      'skill',
      'edit_skill',
      {
        entityId: 'skill-1',
        documentFormat: SKILL_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
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
      entityName: 'Existing Skill',
      documentFormat: SKILL_DOCUMENT_FORMAT,
    })
    expect(result).not.toHaveProperty('requiresReview')
    expect(result).not.toHaveProperty('preview')
    expect(mockApplySavedEntityState.mock.calls[0]?.[4]).toEqual({
      description: 'Updated description',
      content: 'Use the updated process.',
    })
    expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
  })

  it('persists accepted reviewed updates after verifying the reviewed base', async () => {
    const currentFields = {
      description: 'Existing description',
      content: 'Use the existing process.',
    }
    const nextFields = {
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

    expect(mockApplySavedEntityState.mock.calls[0]?.[2]).toBe('workspace-1')
    expect(mockApplySavedEntityState.mock.calls[0]?.[5]).toEqual({
      expectedReviewBaseStateHash: hashServerToolReviewBase(currentFields),
    })
  })

  it('renames only the identity field and reviews only identity state', async () => {
    mockReadEntityListMembersFromDb.mockResolvedValue([{ id: 'skill-1', name: 'Existing Skill' }])
    const staged = await executeRenameEntityMutation(
      'skill',
      'rename_skill',
      { entityId: 'skill-1', name: 'Renamed Skill' },
      { userId: 'user-1', accessLevel: 'limited' }
    )

    expect('preview' in staged ? staged.preview.documentDiff : null).toEqual({
      before: '{\n  "name": "Existing Skill"\n}',
      after: '{\n  "name": "Renamed Skill"\n}',
    })
    expect(mockRenameSavedEntityIdentity).not.toHaveBeenCalled()

    const committed = await executeRenameEntityMutation(
      'skill',
      'rename_skill',
      { entityId: 'skill-1', name: 'Renamed Skill' },
      { userId: 'user-1', accessLevel: 'full' }
    )
    expect(mockRenameSavedEntityIdentity).toHaveBeenCalledWith({
      entityKind: 'skill',
      entityId: 'skill-1',
      workspaceId: 'workspace-1',
      ownerUserId: null,
      name: 'Renamed Skill',
    })
    expect(committed).toMatchObject({ updatedAt: '2026-07-11T12:00:00.000Z' })
    expect(mockApplySavedEntityState).not.toHaveBeenCalled()
    expect(mockReadBootstrappedSavedEntityFields).not.toHaveBeenCalled()
  })

  it('uses the canonical custom-tool identity for review and persistence', async () => {
    mockReadEntityListMembersFromDb.mockResolvedValueOnce([{ id: 'tool-1', name: 'Existing Tool' }])

    const result = await executeRenameEntityMutation(
      'custom_tool',
      'rename_custom_tool',
      { entityId: 'tool-1', name: '  My   Tool  ' },
      { userId: 'user-1', accessLevel: 'full' }
    )

    expect(result).toMatchObject({
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      entityName: 'My Tool',
    })
    expect(result).not.toHaveProperty('entityDocument')
    expect(mockRenameSavedEntityIdentity).toHaveBeenCalledWith({
      entityKind: 'custom_tool',
      entityId: 'tool-1',
      workspaceId: 'workspace-1',
      ownerUserId: null,
      name: 'My Tool',
    })
  })

  it('rejects non-canonical indicator metadata instead of silently adapting it', async () => {
    const pineCode = `
const mode = input.enum('fast', 'Mode', ['fast', 'slow'])
const length = input.int(14, 'Length', 1, 50, 1)
`

    await expect(
      executeUpdateEntityDocumentMutation(
        'indicator',
        'edit_indicator',
        {
          entityId: 'indicator-1',
          documentFormat: INDICATOR_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
            color: '#10b981',
            pineCode,
            inputMeta: {
              Stale: { title: 'Stale', type: 'string', defval: 'old' },
            },
          }),
        },
        { userId: 'user-1', accessLevel: 'full' }
      )
    ).rejects.toThrow(/inputMeta/)

    expect(mockApplySavedEntityState).not.toHaveBeenCalled()
  })

  it('rejects MCP server create documents without a URL', async () => {
    const create = vi.fn()

    await expect(
      executeCreateEntityDocumentMutation(
        'mcp_server',
        {
          workspaceId: 'workspace-1',
          name: 'Missing URL MCP',
          documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
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
    ).toMatchObject({ url: '', enabled: false })
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

  it('returns repairable watchlist document errors before persisting state', async () => {
    const listing = {
      listing_id: 'AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default' as const,
    }
    for (const { items, status, message } of [
      {
        items: [{ type: 'listing', parentId: 'missing-section', listing }],
        status: 400,
        message: 'Watchlist item parentId must reference a section',
      },
      {
        items: [
          { type: 'listing', parentId: null, listing },
          { type: 'listing', parentId: null, listing },
        ],
        status: 409,
        message: 'Listing already exists in watchlist',
      },
    ]) {
      await expect(
        executeUpdateEntityDocumentMutation(
          'watchlist',
          'edit_watchlist',
          {
            entityId: 'watchlist-1',
            documentFormat: WATCHLIST_DOCUMENT_FORMAT,
            entityDocument: JSON.stringify({
              settings: { showLogo: true, showTicker: true, showDescription: false },
              items,
            }),
          },
          { userId: 'user-1', accessLevel: 'full' }
        )
      ).rejects.toMatchObject({
        status,
        code: 'invalid_watchlist_document',
        message,
        retryable: true,
        issues: [{ path: 'entityDocument', message }],
        hint: expect.stringMatching(/read_watchlist.*search_listing/),
      })
    }

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

    expect(mockApplySavedEntityState.mock.calls[0]?.[4]).toMatchObject({
      headers: { Authorization: 'Bearer token' },
    })
  })

  it('keeps Studio create mutations in review mode and validates accepted lists in the owner', async () => {
    const staged = await executeCreateEntityDocumentMutation(
      'skill',
      {
        workspaceId: 'workspace-1',
        name: 'New Skill',
        documentFormat: SKILL_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
          description: 'New description',
          content: 'Use the new process.',
        }),
      },
      { userId: 'user-1', accessLevel: 'limited' },
      vi.fn()
    )

    expect(staged).toMatchObject({
      requiresReview: true,
      success: true,
      workspaceId: 'workspace-1',
      entityKind: 'skill',
      entityName: 'New Skill',
      documentFormat: SKILL_DOCUMENT_FORMAT,
    })
    expect('preview' in staged ? staged.preview.documentDiff.before : undefined).toBe('')
    expect('preview' in staged ? staged.preview.documentDiff.after : undefined).not.toContain(
      'New Skill'
    )

    const reviewBaseStateHash =
      'reviewBaseStateHash' in staged ? staged.reviewBaseStateHash : undefined
    if (!reviewBaseStateHash) throw new Error('Expected a staged create review hash')
    mockReadEntityListMembersFromDb.mockResolvedValueOnce([
      { id: 'skill-2', name: 'Created after review' },
    ])
    const create = vi.fn(
      async (
        _name: string,
        _fields: Record<string, unknown>,
        createContext: EntityCreateContext
      ) => {
        await createContext.beforeInsert?.({} as never)
        return { entityId: 'skill-created', entityName: 'New Skill', fields: {} }
      }
    )

    await expect(
      executeCreateEntityDocumentMutation(
        'skill',
        {
          workspaceId: 'workspace-1',
          name: 'New Skill',
          documentFormat: SKILL_DOCUMENT_FORMAT,
          entityDocument: JSON.stringify({
            description: 'New description',
            content: 'Use the new process.',
          }),
        },
        {
          userId: 'user-1',
          accessLevel: 'full',
          acceptedReviewBaseStateHash: reviewBaseStateHash,
        },
        create
      )
    ).rejects.toThrow(/stale/i)
    expect(create).toHaveBeenCalledOnce()
  })

  it('redacts MCP server credentials from Copilot documents and review diffs', async () => {
    const readEnvelope = buildDocumentEnvelope('mcp_server', 'mcp-1', 'Private MCP', {
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
        name: 'Private MCP',
        documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
        entityDocument: JSON.stringify({
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

    const documents = [readEnvelope.entityDocument, after, diff.before, diff.after].join()
    expect(documents).not.toMatch(/read-secret|secret-token|old-secret/)
    expect(documents).toContain('[redacted]')
    await expect(
      executeCreateEntityDocumentMutation(
        'mcp_server',
        {
          workspaceId: 'workspace-1',
          name: 'Private MCP',
          documentFormat: MCP_SERVER_DOCUMENT_FORMAT,
          entityDocument: after,
        },
        { userId: 'user-1', accessLevel: 'full' },
        vi.fn()
      )
    ).rejects.toThrow(/Cannot use for new MCP server headers value/i)
  })
})
