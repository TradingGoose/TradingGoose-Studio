/** @vitest-environment node */
import { workflowLogWebhook, workflowLogWebhookDelivery } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  url: process.env.MASTRA_TEST_DATABASE_URL,
  client: undefined as any,
  db: undefined as any,
  trigger: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('@tradinggoose/db', async () => {
  if (!fixture.url) return { db: {} }
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  fixture.client = postgres(fixture.url, { max: 1, prepare: false })
  fixture.db = drizzle(fixture.client)
  return { db: fixture.db }
})
vi.mock('@/lib/billing/native-finance', () => ({ verifyFinancialAcceptance: fixture.verify }))
vi.mock('@/background/logs-webhook-delivery', () => ({
  logsWebhookDelivery: { trigger: fixture.trigger },
}))

import { emitWorkflowExecutionCompleted } from './events'

const tests = fixture.url ? describe : describe.skip
tests('disposable PostgreSQL completion publication identity', () => {
  const schema = `completion_${crypto.randomUUID().replaceAll('-', '')}`
  const log = {
    id: 'original-log',
    executionId: 'original-execution',
    workspaceId: 'original-workspace',
    workflowId: 'original-workflow',
    workflowSummary: { id: 'original-workflow' },
    level: 'info',
    trigger: 'api',
    executionData: {
      environment: {
        userId: 'original-actor',
        workflowId: 'original-workflow',
        workspaceId: 'original-workspace',
        executionId: 'original-execution',
      },
      billing: {
        binding: {
          namespace: 'billing-usage:user:original-actor',
          key: 'invocation:original-execution',
          fingerprint: 'original-fingerprint',
          runId: 'original-execution',
          actorUserId: 'original-actor',
          workspaceId: 'original-workspace',
          workflowId: 'original-workflow',
          purpose: 'workflow-execution',
        },
      },
    },
  }
  beforeAll(async () => {
    if (
      !fixture.url ||
      !['localhost', '127.0.0.1'].includes(new URL(fixture.url).hostname) ||
      !new URL(fixture.url).pathname.endsWith('_disposable')
    )
      throw new Error('Disposable loopback database required')
    await fixture.client.unsafe(`create schema "${schema}"`)
    await fixture.client.unsafe(`set search_path to "${schema}"`)
    for (const table of [workflowLogWebhook, workflowLogWebhookDelivery]) {
      const config = getTableConfig(table)
      const columns = config.columns
        .map((column) => {
          const type = column.getSQLType()
          return `"${column.name}" ${/^(text|varchar|integer|bigint|boolean|timestamp|json|uuid|numeric|double)/.test(type) ? type : 'text'}${column.name === 'id' ? ' primary key' : ''}`
        })
        .join(',')
      await fixture.client.unsafe(`create table "${config.name}" (${columns})`)
    }
    await fixture.db.insert(workflowLogWebhook).values({
      id: 'subscription',
      workflowId: log.workflowId,
      url: 'https://first.invalid',
      active: true,
      levelFilter: ['info'],
      triggerFilter: ['api'],
    })
    fixture.verify.mockResolvedValue({ accepted: true, appliedUsd: '0', modelUsd: 'unavailable' })
    fixture.trigger.mockResolvedValue(undefined)
  }, 20_000)
  afterAll(async () => {
    if (fixture.client) {
      await fixture.client.unsafe(`drop schema if exists "${schema}" cascade`)
      await fixture.client.end({ timeout: 2 })
    }
  })
  it('coalesces concurrent insert attempts, freezes the first snapshot, and lets one pending CAS claim contact', async () => {
    await Promise.all(Array.from({ length: 25 }, () => emitWorkflowExecutionCompleted(log)))
    const rows = await fixture.db.select().from(workflowLogWebhookDelivery)
    expect(rows).toHaveLength(1)
    const [delivery] = rows
    expect(delivery.subscriptionSnapshot.url).toBe('https://first.invalid')
    await fixture.db
      .update(workflowLogWebhook)
      .set({ url: 'https://later.invalid' })
      .where(eq(workflowLogWebhook.id, 'subscription'))
    await emitWorkflowExecutionCompleted(log)
    const claims = await Promise.all(
      Array.from({ length: 12 }, () =>
        fixture.db
          .update(workflowLogWebhookDelivery)
          .set({ status: 'in_progress', attempts: 1 })
          .where(
            and(
              eq(workflowLogWebhookDelivery.id, delivery.id),
              eq(workflowLogWebhookDelivery.status, 'pending')
            )
          )
          .returning()
      )
    )
    expect(claims.flat()).toHaveLength(1)
    const triggerCount = fixture.trigger.mock.calls.length
    await emitWorkflowExecutionCompleted(log)
    expect(fixture.trigger).toHaveBeenCalledTimes(triggerCount)
    const [current] = await fixture.db.select().from(workflowLogWebhookDelivery)
    expect(current).toMatchObject({
      id: delivery.id,
      status: 'in_progress',
      attempts: 1,
      subscriptionSnapshot: { url: 'https://first.invalid' },
    })
  })
})
