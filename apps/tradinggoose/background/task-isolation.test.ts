/** @vitest-environment node */
import { expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ businessImports: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({
  task: (definition: unknown) => definition,
  timeout: { None: 2_147_483_647 },
}))
vi.mock('@/lib/env', () => ({ env: {} }))
vi.mock('@/lib/copilot/agent/worker', () => {
  m.businessImports('copilot')
  throw new Error('Eager Copilot import')
})
vi.mock('./pending-execution-worker', () => {
  m.businessImports('pending')
  throw new Error('Eager queue worker import')
})
vi.mock('./workflow-execution', () => {
  m.businessImports('workflow')
  throw new Error('Eager workflow import')
})
vi.mock('./webhook-execution', () => {
  m.businessImports('webhook')
  throw new Error('Eager webhook import')
})
vi.mock('./schedule-execution', () => {
  m.businessImports('schedule')
  throw new Error('Eager schedule import')
})
vi.mock('./monitor-execution', () => {
  m.businessImports('monitor')
  throw new Error('Eager monitor import')
})
vi.mock('./knowledge-processing', () => {
  m.businessImports('document')
  throw new Error('Eager document import')
})
vi.mock('./logs-webhook-delivery', () => {
  m.businessImports('delivery')
  throw new Error('Eager log delivery import')
})

import { copilotExecutionTask } from './tasks/copilot-execution'
import { documentExecutionTask } from './tasks/document-execution'
import { logsWebhookDelivery } from './tasks/logs-webhook-delivery'
import { monitorExecutionTask } from './tasks/monitor-execution'
import { pendingExecutionTask } from './tasks/pending-execution'
import { scheduleExecutionTask } from './tasks/schedule-execution'
import { webhookExecutionTask } from './tasks/webhook-execution'
import { workflowExecutionTask } from './tasks/workflow-execution'

it('registers every separate task without loading any execution runner', () => {
  expect([
    workflowExecutionTask.id,
    webhookExecutionTask.id,
    scheduleExecutionTask.id,
    monitorExecutionTask.id,
    documentExecutionTask.id,
    copilotExecutionTask.id,
    pendingExecutionTask.id,
    logsWebhookDelivery.id,
  ]).toEqual([
    'workflow-execution',
    'webhook-execution',
    'schedule-execution',
    'monitor-execution',
    'document-execution',
    'copilot-execution',
    'pending-execution',
    'logs-webhook-delivery',
  ])
  expect(m.businessImports).not.toHaveBeenCalled()
  expect(documentExecutionTask).toMatchObject({ machine: 'large-1x', maxDuration: 600 })
})

it('rejects a mismatched native task before loading an execution runner', async () => {
  await expect(
    (workflowExecutionTask as any).run({ executionType: 'copilot', id: 'foreign', payload: {} }, {})
  ).rejects.toThrow('Execution task type differs')
  expect(m.businessImports).not.toHaveBeenCalled()
})
