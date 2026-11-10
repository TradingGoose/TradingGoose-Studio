import { randomUUID } from 'node:crypto'
import { Agent } from '@mastra/core/agent'
import { createDurableAgent } from '@mastra/core/agent/durable'
import { Mastra } from '@mastra/core/mastra'
import { NoOpObservability } from '@mastra/core/observability'
import { MessageHistory } from '@mastra/core/processors'
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock'
import { Memory } from '@mastra/memory'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { encodeWorkflowMessage } from './messages'
import { NATIVE_AGENT_POLICY, trustedPrepareStep } from './options'
import { assertNativeCompletion } from './result'
import { createNativeStorage, PASSIVE_MEMORY_OPTIONS } from './runtime'

const url = process.env.MASTRA_TEST_DATABASE_URL
const disposable =
  url &&
  ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) &&
  new URL(url).pathname.endsWith('_disposable')

describe.runIf(Boolean(disposable))('ordinary public native storage and completion', () => {
  let native: ReturnType<typeof createNativeStorage>
  beforeAll(async () => {
    native = createNativeStorage(url!, true)
    await native.storage.init()
    await native.verifyCapabilities()
  }, 30000)
  afterAll(async () => {
    await native?.close()
  })

  it('uses no-op observability, off recovery, and supports scoped canonical reads on supplied pools', async () => {
    const mastra = new Mastra({
      storage: native.storage,
      recovery: { workflows: 'off', durableAgents: 'off' },
    })
    expect(mastra.observability).toBeInstanceOf(NoOpObservability)
    expect(mastra.observability.listInstances().size).toBe(0)
    expect(mastra.recoveryConfig).toMatchObject({ workflows: 'off', durableAgents: 'off' })
    const memory = await native.storage.getStore('memory')
    const workflows = await native.storage.getStore('workflows')
    expect(await memory!.supportsRunFencing()).toBe(true)
    expect(await workflows!.supportsRunFencing()).toBe(true)
  })

  it('uses a scoped DML-only runtime role and refuses missing read privileges without initializing schema', async () => {
    const owner = new Pool({ connectionString: url!, max: 1 })
    const role = `native_runtime_${randomUUID().replaceAll('-', '')}`
    const database = new URL(url!).pathname.slice(1).replaceAll('"', '""')
    let runtime: ReturnType<typeof createNativeStorage> | undefined
    let check: Pool | undefined
    try {
      await owner.query(
        `CREATE ROLE "${role}" LOGIN PASSWORD 'disposable-runtime-only' NOSUPERUSER NOCREATEDB NOCREATEROLE`
      )
      await owner.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`)
      await owner.query(`GRANT USAGE ON SCHEMA mastra TO "${role}"`)
      await owner.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mastra TO "${role}"`
      )
      await owner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mastra TO "${role}"`)
      const scoped = new URL(url!)
      scoped.username = role
      scoped.password = 'disposable-runtime-only'
      runtime = createNativeStorage(scoped.toString())
      check = new Pool({ connectionString: scoped.toString(), max: 1 })
      const permissions = (
        await check.query(
          `SELECT current_user AS role, has_schema_privilege('mastra', 'CREATE') AS create, has_schema_privilege('mastra', 'USAGE') AS usage`
        )
      ).rows[0]
      expect(permissions).toEqual({ role, create: false, usage: true })
      await expect(
        check.query('CREATE TABLE mastra.forbidden_runtime_ddl (id text)')
      ).rejects.toThrow(/permission denied/)
      await runtime.verifyCapabilities()
      const store = (await runtime.storage.getStore('memory'))!
      const memory = new Memory({ storage: runtime.storage, options: PASSIVE_MEMORY_OPTIONS })
      const scope = {
        threadId: `workflow-memory:role:${randomUUID()}`,
        resourceId: `workflow-memory:role:${randomUUID()}`,
      }
      await memory.createThread({ ...scope, title: 'DML-only fixture' })
      const message = encodeWorkflowMessage(
        { role: 'system', content: 'exact policy' },
        scope,
        new Date()
      )
      await store.saveMessages({ messages: [message] })
      expect(
        (
          await store.listMessages({ ...scope, page: 0, perPage: 100, includeTotal: true })
        ).messages.map((row) => row.id)
      ).toEqual([message.id])
      await owner.query(`REVOKE SELECT ON ALL TABLES IN SCHEMA mastra FROM "${role}"`)
      await expect(runtime.verifyCapabilities()).rejects.toThrow()
    } finally {
      await runtime?.close()
      await check?.end()
      await owner.query(`DROP OWNED BY "${role}"`)
      await owner.query(`DROP ROLE "${role}"`)
      await owner.end()
    }
  }, 30000)

  it('keeps the public-ready payload readable and admits a distinct native run while only fence retirement is paused', async () => {
    const store = (await native.storage.getStore('memory'))!
    const memory = new Memory({ storage: native.storage, options: PASSIVE_MEMORY_OPTIONS })
    const threadId = `completion-fixture:${randomUUID()}`
    const resourceId = `completion-fixture:${randomUUID()}`
    const firstRun = randomUUID()
    let releaseTail!: () => void
    const blocked = new Promise<void>((resolve) => {
      releaseTail = resolve
    })
    let tailEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      tailEntered = resolve
    })
    const original = store.retireRunFence.bind(store)
    const retire = vi.spyOn(store, 'retireRunFence').mockImplementation(async (fence) => {
      if (fence.runId === firstRun) {
        tailEntered()
        await blocked
      }
      return original(fence)
    })
    let contacts = 0
    const model = new MastraLanguageModelV2Mock({
      doStream: async () => {
        contacts++
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'text-start', id: 'answer' })
              controller.enqueue({ type: 'text-delta', id: 'answer', delta: 'Known output' })
              controller.enqueue({ type: 'text-end', id: 'answer' })
              controller.enqueue({
                type: 'finish',
                finishReason: 'stop',
                usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
              })
              controller.close()
            },
          }),
        }
      },
    })
    const base = new Agent({
      ...NATIVE_AGENT_POLICY,
      id: 'completion-fixture',
      name: 'fixture',
      instructions: '',
      model,
      memory,
      outputProcessors: [new MessageHistory({ storage: store, lastMessages: false })],
    })
    const durable = createDurableAgent({ agent: base })
    const mastra = new Mastra({
      storage: native.storage,
      agents: { fixture: durable },
      recovery: { workflows: 'off', durableAgents: 'off' },
    })
    const agent = mastra.getAgent('fixture')
    const delivered: string[] = []
    try {
      const result = await agent.generate('First input', {
        runId: firstRun,
        memory: { thread: threadId, resource: resourceId },
        modelSettings: { maxRetries: 0 },
        maxProcessorRetries: 0,
        prepareStep: trustedPrepareStep(model),
        onChunk: async (chunk) => {
          if (chunk.type === 'text-delta') delivered.push(chunk.payload.text)
        },
      })
      assertNativeCompletion(result)
      expect(result.text).toBe('Known output')
      expect(delivered.join('')).toBe('Known output')
      await entered
      const saved = await store.listMessages({
        threadId,
        resourceId,
        page: 0,
        perPage: 100,
        includeTotal: true,
      })
      expect(
        saved.messages.some((message) =>
          message.content.parts.some((part) => part.type === 'text' && part.text === 'Known output')
        )
      ).toBe(true)
      const next = await agent.generate('Second input', {
        runId: randomUUID(),
        memory: { thread: threadId, resource: resourceId },
        modelSettings: { maxRetries: 0 },
        maxProcessorRetries: 0,
        prepareStep: trustedPrepareStep(model),
      })
      assertNativeCompletion(next)
      expect(contacts).toBe(2)
      expect(next.text).toBe('Known output')
    } finally {
      releaseTail()
      retire.mockRestore()
      // Test owns this isolated scope; no product destructive safety is inferred from completion.
    }
  }, 30000)
})
