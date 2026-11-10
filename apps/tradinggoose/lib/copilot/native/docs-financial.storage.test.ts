/** @vitest-environment node */
// Real owned SQL, canonical current/installed FINAL public exports and actual
// route/target/router/docs/embedding implementation. Native Pending discovery,
// embedding transport, documentation vector results and signed-proof transport
// are controlled seams. This is not real native service/provider/joint acceptance.
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { FinancialBinding, ModelOccurrence } from '@/lib/billing/native-finance'
import type { Pending } from '@/lib/copilot/native/contract'

function sourceFixture() {
  const statePath = process.env.SOURCE_BILLING_TEST_STATE_FILE
  if (!statePath) return null
  const refuse = (): never => {
    throw new Error('Explicit NEW owned canonical preservation fixture required')
  }
  if (
    process.env.FIXTURE_MUTATION_OPT_IN !== 'r15-v1-fresh-disposable' ||
    !isAbsolute(statePath) ||
    resolve(statePath) !== statePath ||
    realpathSync(statePath) !== statePath ||
    basename(statePath) !== 'state.json' ||
    !/^db-private-[a-z0-9]+$/.test(basename(dirname(statePath)))
  )
    refuse()
  const st = lstatSync(statePath)
  const parent = lstatSync(dirname(statePath))
  const uid = process.getuid?.()
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.nlink !== 1 ||
    uid === undefined ||
    st.uid !== uid ||
    (st.mode & 0o777) !== 0o600 ||
    !parent.isDirectory() ||
    parent.uid !== uid ||
    (parent.mode & 0o777) !== 0o700 ||
    realpathSync(dirname(statePath)) !== dirname(statePath)
  )
    refuse()
  const bytes = readFileSync(statePath)
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    process.env.SOURCE_BILLING_TEST_STATE_SHA256
  )
    refuse()
  const role = z.object({ name: z.string(), password: z.string().min(1) })
  const state = z
    .object({
      version: z.literal('r15-v1'),
      stage: z.literal('ready'),
      smoke: z.unknown().optional(),
      statePath: z.string(),
      id: z.string().regex(/^[a-f0-9]{16}$/),
      database: z.string(),
      marker: z.string().regex(/^r15-v1:[a-f0-9]{48}$/),
      operator: z.string(),
      roles: z.object({ owner: role, studio_app: role, studio_native: role }),
      actors: z
        .array(z.object({ userId: z.string().min(1), workspaceId: z.string().min(1) }))
        .min(1),
    })
    .parse(JSON.parse(bytes.toString('utf8')))
  const input = new URL(process.env.DATABASE_URL ?? '')
  const operator = new URL(state.operator)
  if (
    state.smoke ||
    state.statePath !== statePath ||
    state.database !== `r15_${state.id}` ||
    !['postgres:', 'postgresql:'].includes(input.protocol) ||
    input.protocol !== operator.protocol ||
    input.hostname !== '127.0.0.1' ||
    operator.hostname !== '127.0.0.1' ||
    !input.port ||
    input.port !== operator.port ||
    input.pathname !== `/${state.database}` ||
    input.search ||
    input.hash ||
    state.roles.studio_app.name !== `r15_${state.id}_studio_app` ||
    input.username !== state.roles.studio_app.name ||
    input.password !== state.roles.studio_app.password ||
    Object.keys(process.env).some((key) => key.startsWith('PG') && process.env[key])
  )
    refuse()
  return {
    database: state.database,
    marker: state.marker,
    appRole: state.roles.studio_app.name,
    actors: state.actors,
  }
}
const owned = sourceFixture()
const suite = owned ? describe : describe.skip

// Required actual selected candidate binding. No old/unissued/future fallback.
function candidateFixture() {
  if (!owned) return null
  const mode = process.env.DOCS_FINANCIAL_CANONICAL_MODE
  if (mode !== 'current' && mode !== 'installed')
    throw new Error('Explicit current/installed docs mode required')
  const pinned = (key: string) => {
    const file = process.env[key]
    const expected = process.env[`${key}_SHA256`]
    if (
      !file ||
      !isAbsolute(file) ||
      resolve(file) !== file ||
      realpathSync(file) !== file ||
      !/^[a-f0-9]{64}$/.test(expected ?? '')
    )
      throw new Error(`Actual selected public ${key} path/hash required`)
    const st = lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o644)
      throw new Error(`Public regular selected ${key} required`)
    const bytes = readFileSync(file)
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error(`Changed selected ${key}`)
    return { file, bytes }
  }
  const parent = pinned('DOCS_FINANCIAL_PARENT_SELECTION_FILE')
  const manifest = pinned('DOCS_FINANCIAL_CANDIDATE_MANIFEST_FILE')
  const entry = pinned('DOCS_FINANCIAL_CANDIDATE_ENTRY')
  const selection = JSON.parse(parent.bytes.toString('utf8'))
  const publication = JSON.parse(manifest.bytes.toString('utf8'))
  const main = publication.tarFiles?.find((item: any) => item.path === 'dist/index.js')
  if (
    selection.status !== 'SELECTED_FOR_LOCAL_CONSUMER_INTEGRATION_AND_VALIDATION' ||
    selection.package !== '@tradinggoose/billing' ||
    selection.version !== publication.version ||
    selection.manifest?.sha256 !== createHash('sha256').update(manifest.bytes).digest('hex') ||
    selection.manifest.bytes !== manifest.bytes.length ||
    selection.tarball?.sha256 !== publication.tarball?.sha256 ||
    selection.tarball?.bytes !== publication.tarball?.bytes ||
    !main ||
    main.sha256 !== createHash('sha256').update(entry.bytes).digest('hex') ||
    main.bytes !== entry.bytes.length ||
    !entry.file.endsWith('/node_modules/@tradinggoose/billing/dist/index.js')
  )
    throw new Error('Actual issued/selected installed final candidate tuple required')
  const installedPackage = JSON.parse(
    readFileSync(resolve(dirname(entry.file), '../package.json'), 'utf8')
  )
  const currentEntry = resolve(import.meta.dirname, '../../../../../packages/billing/dist/index.js')
  const currentBytes = readFileSync(currentEntry)
  if (
    installedPackage.version !== selection.version ||
    createHash('sha256').update(currentBytes).digest('hex') !== main.sha256 ||
    currentBytes.length !== main.bytes
  )
    throw new Error(
      'Current default compiled main and physically installed FINAL main must both match selection'
    )
  return { mode, entry: entry.file, version: selection.version }
}
const candidate = candidateFixture()
vi.mock('@tradinggoose/billing', async (original) =>
  candidate?.mode === 'installed'
    ? await import(pathToFileURL(candidate.entry).href)
    : await original<typeof import('@tradinggoose/billing')>()
)

const WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT = 'unused-owned-test-workflow-format'
const editWorkflowExecute = vi.fn(async () => ({
  entityKind: 'workflow',
  entityId: 'workflow-123',
  entityName: 'Workflow 1',
  entityDocument: 'flowchart TD\n  n1["Input<br/>id: input1<br/>type: input_trigger"]',
  documentFormat: WORKFLOW_GRAPH_MERMAID_DOCUMENT_FORMAT,
  workflowState: { blocks: {} },
}))
const readWorkflowLogsExecute = vi.fn(async () => ({
  entries: [],
  totalEntries: 0,
  entityId: 'workflow-123',
  retrievedAt: '2026-08-13T00:00:00.000Z',
  truncated: true,
}))
const getIndicatorCatalogExecute = vi.fn(async () => ({
  sections: [],
  items: [],
  count: 0,
}))
const getIndicatorMetadataExecute = vi.fn(async () => ({
  items: [],
  missingIds: [],
}))
const agentAccessoryCatalogResult = { tools: [], skills: [] }
const getAgentAccessoryCatalogExecute = vi.fn(async () => agentAccessoryCatalogResult)
const listGDriveFilesExecute = vi.fn(async () => ({ files: [] }))
const readGDriveFileExecute = vi.fn(async () => ({ content: '' }))
const readCredentialsExecute = vi.fn(async () => ({
  oauth: {
    connected: { credentials: [], total: 0 },
    notConnected: { services: [], total: 0 },
  },
  environment: { variableNames: [], count: 0 },
}))
const readEnvironmentVariablesExecute = vi.fn(async () => ({
  variableNames: [],
  personalVariableNames: [],
  workspaceVariableNames: [],
  conflicts: [],
  count: 0,
}))
const readOAuthCredentialsExecute = vi.fn(async () => ({ credentials: [], total: 0 }))
const setEnvironmentVariablesExecute = vi.fn(async () => ({
  success: true,
  scope: 'workspace',
  message: 'ok',
}))
const searchListingExecute = vi.fn(async () => ({ results: [] }))
const noopEntityExecute = vi.fn(async () => ({}))

const entityTool = (name: string, execute = noopEntityExecute) => ({ name, execute })

vi.mock('@/lib/copilot/tools/server/blocks/get-available-blocks', () => ({
  getAvailableBlocksServerTool: {
    name: 'get_available_blocks',
    execute: vi.fn(async () => ({ blocks: [] })),
  },
}))
vi.mock('@/lib/copilot/tools/server/blocks/get-blocks-metadata', () => ({
  getBlocksMetadataServerTool: {
    name: 'get_blocks_metadata',
    execute: vi.fn(async () => ({ metadata: {} })),
  },
}))
vi.mock('@/lib/copilot/tools/server/agent/get-agent-accessory-catalog', () => ({
  getAgentAccessoryCatalogServerTool: {
    name: 'get_agent_accessory_catalog',
    execute: getAgentAccessoryCatalogExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/indicators/get-indicator-catalog', () => ({
  getIndicatorCatalogServerTool: {
    name: 'get_indicator_catalog',
    execute: getIndicatorCatalogExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/indicators/get-indicator-metadata', () => ({
  getIndicatorMetadataServerTool: {
    name: 'get_indicator_metadata',
    execute: getIndicatorMetadataExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/listing/search-listing', () => ({
  searchListingServerTool: {
    name: 'search_listing',
    execute: searchListingExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/list-files', () => ({
  listGDriveFilesServerTool: { name: 'list_gdrive_files', execute: listGDriveFilesExecute },
}))
vi.mock('@/lib/copilot/tools/server/gdrive/read-file', () => ({
  readGDriveFileServerTool: { name: 'read_gdrive_file', execute: readGDriveFileExecute },
}))
vi.mock('@/lib/copilot/tools/server/knowledge/knowledge-base', () => ({
  listKnowledgeBasesServerTool: {
    name: 'list_knowledge_bases',
    execute: vi.fn(async () => ({ entityKind: 'knowledge_base', entities: [], count: 0 })),
  },
  readKnowledgeBaseServerTool: {
    name: 'read_knowledge_base',
    execute: vi.fn(),
  },
  createKnowledgeBaseServerTool: {
    name: 'create_knowledge_base',
    execute: vi.fn(),
  },
  editKnowledgeBaseServerTool: {
    name: 'edit_knowledge_base',
    execute: vi.fn(),
  },
  renameKnowledgeBaseServerTool: {
    name: 'rename_knowledge_base',
    execute: vi.fn(),
  },
  queryKnowledgeBaseServerTool: {
    name: 'query_knowledge_base',
    execute: vi.fn(),
  },
}))
vi.mock('@/lib/copilot/tools/server/other/make-api-request', () => ({
  makeApiRequestServerTool: {
    name: 'make_api_request',
    execute: vi.fn(async () => ({ success: true })),
  },
}))
vi.mock('@/lib/copilot/tools/server/other/search-online', () => ({
  searchOnlineServerTool: { name: 'search_online', execute: vi.fn(async () => ({ results: [] })) },
}))
vi.mock('@/lib/copilot/tools/server/user/read-credentials', () => ({
  readCredentialsServerTool: { name: 'read_credentials', execute: readCredentialsExecute },
}))
vi.mock('@/lib/copilot/tools/server/user/read-environment-variables', () => ({
  readEnvironmentVariablesServerTool: {
    name: 'read_environment_variables',
    execute: readEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/read-oauth-credentials', () => ({
  readOAuthCredentialsServerTool: {
    name: 'read_oauth_credentials',
    execute: readOAuthCredentialsExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/user/set-environment-variables', () => ({
  setEnvironmentVariablesServerTool: {
    name: 'set_environment_variables',
    execute: setEnvironmentVariablesExecute,
  },
}))
vi.mock('@/lib/copilot/tools/server/entities', () => ({
  createCustomToolServerTool: entityTool('create_custom_tool'),
  createIndicatorServerTool: entityTool('create_indicator'),
  createLayoutServerTool: entityTool('create_layout'),
  createMcpServerServerTool: entityTool('create_mcp_server'),
  createSkillServerTool: entityTool('create_skill'),
  createWatchlistServerTool: entityTool('create_watchlist'),
  createWorkflowServerTool: entityTool('create_workflow'),
  editCustomToolServerTool: entityTool('edit_custom_tool'),
  editIndicatorServerTool: entityTool('edit_indicator'),
  editMcpServerServerTool: entityTool('edit_mcp_server'),
  editSkillServerTool: entityTool('edit_skill'),
  editWatchlistServerTool: entityTool('edit_watchlist'),
  editWorkflowVariableServerTool: entityTool('edit_workflow_variable'),
  listCustomToolsServerTool: entityTool('list_custom_tools'),
  listIndicatorsServerTool: entityTool('list_indicators'),
  listLayoutsServerTool: entityTool('list_layout'),
  listMcpServersServerTool: entityTool('list_mcp_servers'),
  listSkillsServerTool: entityTool('list_skills'),
  listWatchlistsServerTool: entityTool('list_watchlist'),
  listWorkflowsServerTool: entityTool('list_workflows'),
  readCustomToolServerTool: entityTool('read_custom_tool'),
  readIndicatorServerTool: entityTool('read_indicator'),
  readLayoutServerTool: entityTool('read_layout'),
  renameLayoutServerTool: entityTool('rename_layout'),
  readMcpServerServerTool: entityTool('read_mcp_server'),
  readSkillServerTool: entityTool('read_skill'),
  readWatchlistServerTool: entityTool('read_watchlist'),
  readWorkflowServerTool: entityTool('read_workflow'),
  renameCustomToolServerTool: entityTool('rename_custom_tool'),
  renameIndicatorServerTool: entityTool('rename_indicator'),
  renameMcpServerServerTool: entityTool('rename_mcp_server'),
  renameSkillServerTool: entityTool('rename_skill'),
  renameWatchlistServerTool: entityTool('rename_watchlist'),
  renameWorkflowServerTool: entityTool('rename_workflow'),
}))
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow', () => ({
  editWorkflowServerTool: { name: 'edit_workflow', execute: editWorkflowExecute },
}))
vi.mock('@/lib/copilot/tools/server/workflow/edit-workflow-block', () => ({
  editWorkflowBlockServerTool: entityTool('edit_workflow_block'),
}))
vi.mock('@/lib/copilot/tools/server/workflow/read-workflow-logs', () => ({
  readWorkflowLogsServerTool: {
    name: 'read_workflow_logs',
    execute: readWorkflowLogsExecute,
  },
}))

const docs = vi.hoisted(() => ({
  actor: '',
  parent: undefined as Pending | undefined,
  readCount: 0,
  contacts: 0,
  reads: [] as string[],
  bindings: [] as FinancialBinding[],
  readHook: undefined as undefined | ((count: number) => Promise<void>),
  afterCreate: undefined as undefined | (() => Promise<void>),
  afterAdmit: undefined as undefined | (() => Promise<void>),
  duringContact: undefined as undefined | (() => Promise<void>),
  transportFailure: false,
  vectorFailure: false,
  proofFailure: false,
  cancelAfterContact: undefined as AbortController | undefined,
}))
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ user: { id: docs.actor } }) }))
vi.mock('@/lib/copilot/native/client', () => ({
  readNativeCopilot: async (request: any) => {
    docs.readCount++
    await docs.readHook?.(docs.readCount)
    return {
      status: 200,
      result: {
        protocolRevision: request.protocolRevision,
        requestId: request.requestId,
        status: 'pending_targets',
        page: request.page,
        items: [structuredClone(docs.parent!)],
        hasMore: false,
      },
    }
  },
}))
vi.mock('@/lib/copilot/native/readback', () => ({ readbackNativeToolResult: vi.fn() }))
vi.mock('@/lib/copilot/result-proof', () => ({
  createCopilotToolResultProof: async () => {
    if (docs.proofFailure) throw new Error('Controlled post-completion proof failure')
    return 'controlled-source-test-result-proof'
  },
}))
vi.mock('@/lib/copilot/config', () => ({
  getCopilotConfig: () => ({ rag: { similarityThreshold: 0.3 } }),
}))
vi.mock('@/lib/mastra/connections', () => ({
  // Isolate configured connections; actual installed native registry fallback remains real.
  getConfiguredProviders: () => ({}),
  resolveConfiguredModel: (id: string) => ({ id }),
}))
vi.mock('@/lib/system-services/runtime', () => ({
  resolveOpenAIServiceConfig: async () => ({ defaultApiKey: 'synthetic-docs-source-key' }),
}))
vi.mock('@mastra/core/llm', async (original) => ({
  ...(await original<typeof import('@mastra/core/llm')>()),
  ModelRouterEmbeddingModel: class {
    maxEmbeddingsPerCall = 1
    async doEmbed(input: { values: string[]; abortSignal?: AbortSignal }) {
      docs.contacts++
      input.abortSignal?.throwIfAborted()
      await docs.duringContact?.()
      if (docs.transportFailure) throw new Error('Controlled uncertain embedding transport failure')
      docs.cancelAfterContact?.abort()
      return { embeddings: input.values.map(() => [0.25, 0.5]), usage: { tokens: 12 } }
    }
  },
}))
let db: typeof import('@tradinggoose/db').db
let tables: typeof import('@tradinggoose/db/schema')
let policy: typeof import('@tradinggoose/billing')
let finance: typeof import('@/lib/billing/native-finance')
let subscriptionWriter: typeof import('@/lib/billing/financial-subscriptions')
let updateWorkspace: typeof import('@/lib/workspaces/billing-owner').updateWorkspaceFinancialBinding
let POST: typeof import('@/app/api/copilot/execute-copilot-server-tool/route').POST
let routeExecution: typeof import('@/lib/copilot/tools/server/router').routeExecution
let nativeIdentity: typeof import('@/lib/copilot/native/identity').nativeConversationIdentity
let getFacts: typeof import('@/lib/mastra/result').getInferenceFacts
let nativeSource: typeof import('@/lib/copilot/native/target').getNativeFinancialSource
let processContexts: typeof import('@/lib/copilot/process-contents').processContextsServer
let globalFetch: ReturnType<typeof vi.fn>
const realContacts: Promise<unknown>[] = []
let closeObserved = false
async function receipt(binding: FinancialBinding, occurrence?: ModelOccurrence) {
  return policy.readFinancialReceipt(
    db,
    binding.namespace,
    occurrence ? policy.occurrenceKey(binding, occurrence) : binding.key
  )
}
async function person() {
  const id = `docs-${randomUUID()}`
  const at = new Date()
  await db.insert(tables.user).values({
    id,
    name: 'Owned docs source actor',
    email: `${id}@invalid.test`,
    emailVerified: true,
    createdAt: at,
    updatedAt: at,
  })
  await db.insert(tables.userStats).values({
    id: randomUUID(),
    userId: id,
    grantedOnboardingAllowanceUsd: '0',
    customUsageLimit: '100',
  })
  return id
}
async function subscription(owner: { type: 'user' | 'organization'; id: string }) {
  const tier = randomUUID()
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  await db.insert(tables.systemBillingTier).values({
    id: tier,
    displayName: 'Owned docs source tier',
    description: 'Real selected canonical docs child',
    status: 'active',
    ownerType: owner.type,
    usageScope: owner.type === 'organization' ? 'pooled' : 'individual',
    seatMode: 'fixed',
    seatCount: owner.type === 'organization' ? 3 : null,
    includedUsageLimitUsd: '20',
  })
  return subscriptionWriter.createFinancialSubscription({
    id: randomUUID(),
    plan: tier,
    billingTierId: tier,
    referenceType: owner.type,
    referenceId: owner.id,
    status: 'active',
    seats: owner.type === 'organization' ? 3 : 1,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    periodStart: start,
    periodEnd: end,
  })
}
async function organization(actor: string) {
  const id = randomUUID()
  await db.transaction(async (tx) => {
    await policy.initializeFinancialMemberRegistry(tx, id, async () => {
      await tx.insert(tables.organization).values({ id, name: 'Owned docs payer', slug: id })
    })
    await policy.registerFinancialMember(tx, { organizationId: id, userId: actor }, async () => {
      await tx
        .insert(tables.member)
        .values({ id: randomUUID(), organizationId: id, userId: actor, role: 'owner' })
    })
  })
  await subscription({ type: 'organization', id })
  return id
}
async function scenario(kind: 'organization' | 'user' = 'organization') {
  const actor = await person()
  const personal = await subscription({ type: 'user', id: actor })
  let organizationId: string | undefined
  let workspaceId: string | null = null
  if (kind === 'organization') {
    organizationId = await organization(actor)
    workspaceId = randomUUID()
    await db.insert(tables.workspace).values({
      id: workspaceId,
      name: 'Owned docs conversation',
      ownerId: actor,
      billingOwnerType: 'organization',
      billingOwnerOrganizationId: organizationId,
      billingOwnerUserId: null,
    })
    await subscriptionWriter.updateFinancialSubscription(personal.id, { status: 'unpaid' })
  }
  const runId = randomUUID()
  const binding = await finance.createFinancialInvocation({
    actorUserId: actor,
    workspaceId,
    workflowId: null,
    runId,
    purpose: 'copilot',
    operationKey: runId,
    quotedHoldUsd: '0.1',
  })
  const occurrence = { runId, stepNumber: 0, retryCount: 0 }
  await finance.admitFinancialModelStep(binding, occurrence)
  await finance.acceptFinancialModelStep(binding, {
    ...occurrence,
    usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
  })
  docs.actor = actor
  docs.parent = {
    target: {
      resourceId: nativeIdentity({ actorUserId: actor, workspaceId }).resourceId,
      threadId: randomUUID(),
      runId,
      toolCallId: randomUUID(),
      toolName: 'search_documentation',
    },
    stage: 'result',
    originalArgs: { query: 'exact original docs query' },
    financialBinding: binding,
    financialOccurrence: occurrence,
  }
  const original = await receipt(binding, occurrence)
  docs.bindings = []
  return { actor, personal, organizationId, workspaceId, binding, occurrence, original }
}
async function execute(signal?: AbortSignal) {
  const work = POST(
    new NextRequest('https://studio.source.test/api/copilot/execute-copilot-server-tool', {
      method: 'POST',
      body: JSON.stringify({
        native: {
          workspaceId: docs.parent!.financialBinding.workspaceId,
          target: docs.parent!.target,
        },
        action: 'execute',
      }),
      signal,
    })
  )
  realContacts.push(work)
  return work
}
async function originalUnchanged(f: Awaited<ReturnType<typeof scenario>>) {
  expect(await receipt(f.binding, f.occurrence)).toEqual(f.original)
  expect(await finance.verifyFinancialAcceptance(f.binding, f.occurrence)).toMatchObject({
    accepted: true,
  })
}
async function child() {
  const binding = docs.bindings.at(-1)
  if (!binding) throw new Error('Actual canonical embedding child missing')
  return {
    binding,
    operation: await receipt(binding, { runId: binding.runId, stepNumber: 0, retryCount: 0 }),
    invocation: await receipt(binding),
  }
}
beforeAll(async () => {
  if (!owned || !candidate) return
  if (process.env.BILLING_DISPATCH_READY !== 'true' || !process.env.CRON_SECRET?.trim())
    throw new Error('Existing explicit synthetic source-test scheduler readiness required')
  ;({ db } = await import('@tradinggoose/db'))
  tables = await import('@tradinggoose/db/schema')
  policy = await import('@tradinggoose/billing')
  finance = await import('@/lib/billing/native-finance')
  subscriptionWriter = await import('@/lib/billing/financial-subscriptions')
  ;({ updateWorkspaceFinancialBinding: updateWorkspace } = await import(
    '@/lib/workspaces/billing-owner'
  ))
  ;({ nativeConversationIdentity: nativeIdentity } = await import('@/lib/copilot/native/identity'))
  ;({ getInferenceFacts: getFacts } = await import('@/lib/mastra/result'))
  ;({ getNativeFinancialSource: nativeSource } = await import('@/lib/copilot/native/target'))
  const rows = await db.execute(
    sql`select current_user as role, current_database() as database, shobj_description(oid, 'pg_database') as marker from pg_database where datname=current_database()`
  )
  expect(rows[0]).toMatchObject({
    role: owned.appRole,
    database: owned.database,
    marker: owned.marker,
  })
  await policy.assertFinancialStorageReady(db)
  await db
    .insert(tables.systemSettings)
    .values({ id: 'global', billingEnabled: true })
    .onConflictDoUpdate({ target: tables.systemSettings.id, set: { billingEnabled: true } })
  await db.insert(tables.systemBillingSettings).values({ id: 'global' }).onConflictDoNothing()
  const actualSelect = db.select.bind(db)
  vi.spyOn(db, 'select').mockImplementation(((...args: any[]) => {
    const builder = actualSelect(...(args as [any]))
    const actualFrom = builder.from.bind(builder)
    builder.from = ((table: any) =>
      table === tables.docsEmbeddings
        ? {
            limit: async () => [{ chunkId: 'owned-index' }],
            orderBy: () => ({
              limit: async () => {
                if (docs.vectorFailure) throw new Error('Controlled vector post-completion failure')
                return [
                  {
                    chunkId: 'owned-chunk',
                    chunkText: 'Exact source docs bytes',
                    headerText: 'Owned documentation',
                    sourceLink: 'https://docs.source.test/one',
                    similarity: 0.9,
                  },
                ]
              },
            }),
          }
        : actualFrom(table)) as typeof builder.from
    return builder
  }) as typeof db.select)
  const actualCreate = finance.createFinancialInvocation
  vi.spyOn(finance, 'createFinancialInvocation').mockImplementation(async (input) => {
    const binding = await actualCreate(input)
    if (input.purpose === 'embedding') {
      docs.bindings.push(binding)
      await docs.afterCreate?.()
    }
    return binding
  })
  const actualAdmit = finance.admitFinancialModelStep
  vi.spyOn(finance, 'admitFinancialModelStep').mockImplementation(async (binding, occurrence) => {
    const result = await actualAdmit(binding, occurrence)
    if (binding.purpose === 'embedding') await docs.afterAdmit?.()
    return result
  })
  globalFetch = vi.fn(async () => {
    throw new Error('No external network is authorized by source fixture')
  })
  vi.stubGlobal('fetch', globalFetch)
  ;({ POST } = await import('@/app/api/copilot/execute-copilot-server-tool/route'))
  ;({ routeExecution } = await import('@/lib/copilot/tools/server/router'))
  ;({ processContextsServer: processContexts } = await import('@/lib/copilot/process-contents'))
}, 30000)
beforeEach(() => {
  docs.contacts = 0
  docs.readCount = 0
  docs.bindings = []
  docs.readHook = undefined
  docs.afterCreate = undefined
  docs.afterAdmit = undefined
  docs.duringContact = undefined
  docs.transportFailure = false
  docs.vectorFailure = false
  docs.proofFailure = false
  docs.cancelAfterContact = undefined
})
afterAll(async () => {
  // Actual known application calls settle independently from the direct pool close.
  // This is not proof of hidden native/driver scopes or outer owner teardown.
  let knownFailure: unknown
  try {
    await Promise.allSettled(realContacts)
  } catch (error) {
    knownFailure = error
  }
  try {
    if (db) {
      await db.$client.end({ timeout: 2 })
      closeObserved = true
    }
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
  if (knownFailure) throw knownFailure
  if (owned) expect(closeObserved).toBe(true)
})
suite('owned selected-final docs financial scope', () => {
  it.each(['organization', 'user'] as const)(
    'uses authenticated outer %s scope for explicit @docs before any chat invocation',
    async (kind) => {
      const actor = await person()
      await subscription({ type: 'user', id: actor })
      let workspaceId: string | undefined
      let namespace = policy.financialNamespace({ type: 'user', id: actor })
      if (kind === 'organization') {
        const organizationId = await organization(actor)
        workspaceId = randomUUID()
        await db.insert(tables.workspace).values({
          id: workspaceId,
          name: 'Pre-chat docs outer scope',
          ownerId: actor,
          billingOwnerType: 'organization',
          billingOwnerOrganizationId: organizationId,
          billingOwnerUserId: null,
        })
        namespace = policy.financialNamespace({ type: 'organization', id: organizationId })
      }
      docs.actor = actor
      docs.parent = undefined
      docs.bindings = []
      const ctx = Object.assign(
        { kind: 'docs' as const, label: 'Docs' },
        {
          workspaceId: 'forged-context-scope',
          userId: 'forged-context-actor',
          nativeReviewBinding: 'forged-context-marker',
          financialSource: { accepted: true },
        }
      )
      const signal = new AbortController().signal
      const result = await processContexts([ctx], actor, '@Docs canonical source', workspaceId, {
        signal,
      })
      expect(result).toEqual([
        {
          type: 'docs',
          tag: '@Docs',
          content: JSON.stringify([
            {
              id: 1,
              title: 'Owned documentation',
              url: 'https://docs.source.test/one',
              content: 'Exact source docs bytes',
              similarity: 0.9,
            },
          ]),
        },
      ])
      expect((await child()).binding).toMatchObject({
        actorUserId: actor,
        workspaceId: workspaceId ?? null,
        namespace,
        purpose: 'embedding',
      })
      expect((await child()).operation).toMatchObject({
        contactState: 'accepted',
        holdState: 'closed',
      })
      const rows = await db
        .select()
        .from(tables.idempotencyKey)
        .where(eq(tables.idempotencyKey.namespace, namespace))
      expect(
        rows.filter(
          (row) =>
            (row.result as any)?.recordType === 'invocation' &&
            (row.result as any)?.binding?.purpose === 'copilot'
        )
      ).toEqual([])
      expect(docs.readCount).toBe(0)
      expect(docs.contacts).toBe(1)
      expect(globalFetch).not.toHaveBeenCalled()
    }
  )

  it('charges an own organization child while personal contact is blocked and leaves original chat acceptance unchanged', async () => {
    const f = await scenario()
    await expect(
      (async () => {
        const runId = randomUUID()
        const blocked = await finance.createFinancialInvocation({
          actorUserId: f.actor,
          runId,
          purpose: 'embedding',
        })
        await finance.admitFinancialModelStep(blocked, { runId, stepNumber: 0, retryCount: 0 })
      })()
    ).rejects.toThrow()
    docs.bindings = []
    expect(docs.contacts).toBe(0)
    const response = await execute()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      result: { results: [{ content: 'Exact source docs bytes' }] },
    })
    const c = await child()
    expect(c.binding).toMatchObject({
      namespace: f.binding.namespace,
      actorUserId: f.actor,
      workspaceId: f.workspaceId,
      workflowId: null,
      purpose: 'embedding',
    })
    expect(c.binding.key).not.toBe(f.binding.key)
    expect(c.binding.runId).toMatch(/^embedding-copilot-docs:/)
    expect(c.invocation).toMatchObject({ recordType: 'invocation' })
    expect(c.operation).toMatchObject({
      recordType: 'operation',
      contactState: 'accepted',
      holdState: 'closed',
    })
    expect(docs.contacts).toBe(1)
    expect(globalFetch).not.toHaveBeenCalled()
    await originalUnchanged(f)
  })
  it('keeps accepted and uncertain retries on the same original child with no fresh contact or parent readmission', async () => {
    const f = await scenario()
    expect((await execute()).status).toBe(200)
    const first = await child()
    expect((await execute()).status).toBeGreaterThanOrEqual(400)
    expect(docs.bindings.at(-1)?.key).toBe(first.binding.key)
    expect(docs.contacts).toBe(1)
    expect(
      await receipt(first.binding, { runId: first.binding.runId, stepNumber: 0, retryCount: 0 })
    ).toEqual(first.operation)
    await originalUnchanged(f)
    const u = await scenario()
    docs.transportFailure = true
    docs.contacts = 0
    expect((await execute()).status).toBeGreaterThanOrEqual(400)
    const uncertain = await child()
    expect(uncertain.operation).toMatchObject({ recordType: 'operation', holdState: 'outstanding' })
    expect((await execute()).status).toBeGreaterThanOrEqual(400)
    expect(docs.bindings.at(-1)?.key).toBe(uncertain.binding.key)
    expect(docs.contacts).toBe(1)
    expect(
      await receipt(uncertain.binding, {
        runId: uncertain.binding.runId,
        stepNumber: 0,
        retryCount: 0,
      })
    ).toEqual(uncertain.operation)
    await originalUnchanged(u)
  })
  it('rolls back a transferred namespace before child creation and never contacts the new payer', async () => {
    const f = await scenario()
    const next = await organization(f.actor)
    docs.readHook = async (count) => {
      if (count === 3)
        await updateWorkspace({
          actingUserId: f.actor,
          workspaceId: f.workspaceId!,
          billingOwner: { type: 'organization', organizationId: next },
        })
    }
    const response = await execute()
    expect(response.status).toBe(403)
    expect(docs.bindings).toEqual([])
    expect(docs.contacts).toBe(0)
    const nextNamespace = policy.financialNamespace({ type: 'organization', id: next })
    const rows = await db
      .select()
      .from(tables.idempotencyKey)
      .where(eq(tables.idempotencyKey.namespace, nextNamespace))
    expect(rows.filter((row) => (row.result as any)?.recordType === 'invocation')).toEqual([])
    await originalUnchanged(f)
  })
  it('refuses payer transfer before child admission and after admission before contact, retaining the original reservation', async () => {
    const before = await scenario()
    const nextBefore = await organization(before.actor)
    docs.afterCreate = async () =>
      updateWorkspace({
        actingUserId: before.actor,
        workspaceId: before.workspaceId!,
        billingOwner: { type: 'organization', organizationId: nextBefore },
      }).then(() => {})
    expect((await execute()).status).toBeGreaterThanOrEqual(400)
    expect(docs.contacts).toBe(0)
    await originalUnchanged(before)
    docs.afterCreate = undefined
    const after = await scenario()
    const nextAfter = await organization(after.actor)
    docs.contacts = 0
    docs.afterAdmit = async () =>
      updateWorkspace({
        actingUserId: after.actor,
        workspaceId: after.workspaceId!,
        billingOwner: { type: 'organization', organizationId: nextAfter },
      }).then(() => {})
    expect((await execute()).status).toBe(403)
    const retained = await child()
    expect(retained.binding.namespace).toBe(after.binding.namespace)
    expect(retained.operation).toMatchObject({ holdState: 'outstanding' })
    expect(retained.operation).not.toMatchObject({ contactState: 'accepted' })
    expect(docs.contacts).toBe(0)
    const nextNamespace = policy.financialNamespace({ type: 'organization', id: nextAfter })
    const nextRows = await db
      .select()
      .from(tables.idempotencyKey)
      .where(eq(tables.idempotencyKey.namespace, nextNamespace))
    expect(nextRows.filter((row) => (row.result as any)?.recordType === 'invocation')).toEqual([])
    await originalUnchanged(after)
  })
  it('settles an already-contacted completion on the original child after actual payer transfer during doEmbed', async () => {
    const f = await scenario()
    const next = await organization(f.actor)
    docs.duringContact = async () =>
      updateWorkspace({
        actingUserId: f.actor,
        workspaceId: f.workspaceId!,
        billingOwner: { type: 'organization', organizationId: next },
      }).then(() => {})
    expect((await execute()).status).toBe(200)
    const completed = await child()
    expect(completed.operation).toMatchObject({ contactState: 'accepted', holdState: 'closed' })
    expect(completed.binding.namespace).toBe(f.binding.namespace)
    expect(docs.contacts).toBe(1)
    const nextNamespace = policy.financialNamespace({ type: 'organization', id: next })
    const nextRows = await db
      .select()
      .from(tables.idempotencyKey)
      .where(eq(tables.idempotencyKey.namespace, nextNamespace))
    expect(nextRows.filter((row) => (row.result as any)?.recordType === 'invocation')).toEqual([])
    await originalUnchanged(f)
  })
  it('rechecks actual workspace permission and exact Pending before a new child contact', async () => {
    const f = await scenario()
    const newOwner = await person()
    await db
      .update(tables.workspace)
      .set({ ownerId: newOwner })
      .where(eq(tables.workspace.id, f.workspaceId!))
    const permissionId = randomUUID()
    await db.insert(tables.permissions).values({
      id: permissionId,
      userId: f.actor,
      entityType: 'workspace',
      entityId: f.workspaceId!,
      permissionType: 'write',
    })
    docs.readHook = async (count) => {
      if (count === 2)
        await db.delete(tables.permissions).where(eq(tables.permissions.id, permissionId))
    }
    expect((await execute()).status).toBe(403)
    expect(docs.contacts).toBe(0)
    expect(docs.bindings).toEqual([])
    await originalUnchanged(f)
    const changed = await scenario()
    const baseline = docs.readCount
    docs.readHook = async (count) => {
      if (count === baseline + 3) docs.parent!.originalArgs = { query: 'changed original' }
    }
    expect((await execute()).status).toBe(409)
    expect(docs.contacts).toBe(0)
    expect(docs.bindings).toEqual([])
    await originalUnchanged(changed)
  })
  it.each(['vector', 'proof', 'cancel'] as const)(
    'retains actual accepted child accounting on post-contact %s failure',
    async (kind) => {
      const f = await scenario()
      const cancel = new AbortController()
      docs.vectorFailure = kind === 'vector'
      docs.proofFailure = kind === 'proof'
      if (kind === 'cancel') docs.cancelAfterContact = cancel
      const response = await execute(cancel.signal)
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(await response.json()).toMatchObject({
        tokens: { prompt: 12, total: 12 },
        cost: { status: 'unavailable' },
        embeddingUsage: { status: kind === 'cancel' ? 'partial' : 'reported', batches: 1 },
      })
      expect((await child()).operation).toMatchObject({
        contactState: 'accepted',
        holdState: 'closed',
      })
      expect(docs.contacts).toBe(1)
      await originalUnchanged(f)
    }
  )
  it('keeps personal native/global standalone success and refuses marker-lookalikes without financial state', async () => {
    const f = await scenario('user')
    expect((await execute()).status).toBe(200)
    expect((await child()).binding).toMatchObject({
      namespace: f.binding.namespace,
      workspaceId: null,
      purpose: 'embedding',
    })
    await originalUnchanged(f)
    const standalone = await routeExecution(
      'search_documentation',
      { query: 'personal standalone docs' },
      { userId: f.actor }
    )
    expect(getFacts(standalone)).toMatchObject({ tokens: { prompt: 12, total: 12 } })
    expect(docs.contacts).toBe(2)
    expect(nativeSource({ financialSource: { binding: f.binding } })).toBeUndefined()
    await expect(
      routeExecution(
        'search_documentation',
        { query: 'must refuse' },
        {
          userId: f.actor,
          nativeReviewBinding: 'missing-private-source',
        }
      )
    ).rejects.toMatchObject({ status: 403 })
    expect(docs.contacts).toBe(2)
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
