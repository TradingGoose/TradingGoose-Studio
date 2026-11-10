import { describe, expect, it, vi } from 'vitest'
import type { Pending } from '@/lib/copilot/native/contract'
import { nativeResultBinding } from '@/lib/copilot/native/identity'
import { type ToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import {
  createCopilotToolResultProof,
  verifyCopilotToolResultProof,
} from '@/lib/copilot/result-proof'
import { isServerToolReviewRejectedResult } from './review-result'

vi.mock('@/lib/env', () => ({ env: { INTERNAL_API_SECRET: 'synthetic-review-proof-secret' } }))

// Exact current producers, not a second production inventory or a native command catalogue.
const previews: ToolId[] = [
  'create_workflow',
  'edit_workflow',
  'edit_workflow_block',
  'edit_workflow_variable',
  'rename_workflow',
  'create_knowledge_base',
  'edit_knowledge_base',
  'rename_knowledge_base',
  'create_custom_tool',
  'edit_custom_tool',
  'rename_custom_tool',
  'create_indicator',
  'edit_indicator',
  'rename_indicator',
  'create_skill',
  'edit_skill',
  'rename_skill',
  'create_mcp_server',
  'edit_mcp_server',
  'rename_mcp_server',
  'create_watchlist',
  'edit_watchlist',
  'rename_watchlist',
  'create_layout',
  'edit_layout',
  'edit_widget',
  'rename_layout',
  'edit_monitor',
  'set_environment_variables',
]
describe('tool-specific final server preview rejection', () => {
  it.each(previews)(
    '%s admits only its exact final decision, without an applied draft',
    (toolName) => {
      const result = { success: false, rejected: true, toolName }
      expect(ToolResultSchemas[toolName].parse(result)).toEqual(result)
      expect(isServerToolReviewRejectedResult(toolName, result)).toBe(true)
      expect(
        ToolResultSchemas[toolName].safeParse({ ...result, toolName: 'read_workflow' }).success
      ).toBe(false)
      expect(isServerToolReviewRejectedResult(toolName, { ...result, requiresReview: true })).toBe(
        false
      )
      expect(
        isServerToolReviewRejectedResult(toolName, { ...result, entityDocument: 'unapplied' })
      ).toBe(false)
    }
  )
  it('does not add a rejection result branch to ordinary reads or requests', () => {
    for (const toolName of ['read_workflow', 'search_online', 'make_api_request'] as const)
      expect(
        ToolResultSchemas[toolName].safeParse({ success: false, rejected: true, toolName }).success
      ).toBe(false)
    expect(previews).toHaveLength(29)
    expect(new Set(previews).size).toBe(29)
  })
  it('binds a real JOSE decision proof to exact original target, arguments and financial root', async () => {
    const scope = { actorUserId: 'actor', workspaceId: null }
    const pending: Pending = {
      target: {
        threadId: 'thread',
        resourceId: 'resource',
        runId: 'run',
        toolCallId: 'call',
        toolName: 'edit_workflow',
      },
      stage: 'result',
      originalArgs: { entityId: 'workflow', entityDocument: 'exact original document' },
      financialBinding: {
        namespace: 'billing',
        key: 'key',
        fingerprint: 'fingerprint',
        actorUserId: 'actor',
        workspaceId: null,
        workflowId: null,
        runId: 'run',
        purpose: 'copilot',
      },
      financialOccurrence: { stepNumber: 7, retryCount: 2, runId: 'run' },
    }
    const result = ToolResultSchemas.edit_workflow.parse({
      success: false,
      rejected: true,
      toolName: 'edit_workflow',
    })
    const evidence = {
      binding: nativeResultBinding(scope, pending),
      originalArgs: pending.originalArgs,
      result,
    }
    const proof = await createCopilotToolResultProof(evidence)
    await expect(verifyCopilotToolResultProof(proof, evidence)).resolves.toBeUndefined()
    await expect(
      verifyCopilotToolResultProof(proof, { ...evidence, result: { ...result, rejected: false } })
    ).rejects.toThrow()
    await expect(
      verifyCopilotToolResultProof(proof, { ...evidence, originalArgs: { entityId: 'other' } })
    ).rejects.toThrow()
    await expect(
      verifyCopilotToolResultProof(proof, {
        ...evidence,
        binding: nativeResultBinding(scope, {
          ...pending,
          financialBinding: { ...pending.financialBinding, fingerprint: 'other-original-root' },
        }),
      })
    ).rejects.toThrow()
  })
})
