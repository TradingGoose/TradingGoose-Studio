import { describe, expect, it } from 'vitest'
import {
  assertNativeCommandResponse,
  assertNativeCorrelation,
  parseNativeContract,
} from './contract'

const target = {
  threadId: 'thread',
  resourceId: 'resource',
  runId: 'run',
  toolCallId: 'call',
  toolName: 'edit_workflow',
}
const scope = { actorUserId: 'actor', workspaceId: null }
describe('Studio Copilot product contract', () => {
  it('accepts local tool decisions with server-owned arguments and billing', async () => {
    const command = {
      requestId: 'request',
      scope,
      command: 'tool.execute',
      target,
      action: 'review.accept',
      reviewToken: 'review',
      stream: true,
    }
    await expect(parseNativeContract('CopilotRequest', command)).resolves.toEqual(command)
    for (const extra of [
      { result: { success: true } },
      { financialBinding: {} },
      { originalArgs: {} },
      { proof: 'old-proof' },
    ])
      await expect(
        parseNativeContract('CopilotRequest', { ...command, ...extra })
      ).rejects.toThrow()
  })
  it('accepts browser acknowledgements while refusing arbitrary authoritative results', async () => {
    const command = {
      requestId: 'request',
      scope,
      command: 'tool.result',
      target,
      stream: true,
      source: 'browser_assertion',
      assertion: { kind: 'ui.opened', data: { opened: true } },
    }
    await expect(parseNativeContract('CopilotRequest', command)).resolves.toEqual(command)
    await expect(
      parseNativeContract('CopilotRequest', {
        ...command,
        source: 'studio_signed',
        result: { success: true },
        proof: 'proof',
      })
    ).rejects.toThrow()
  })
  it('rejects raw runtime events and extended product events', async () => {
    for (const event of [
      { type: 'step-finish', payload: {} },
      { requestId: 'request', type: 'text.delta', text: 'safe', providerMetadata: {} },
    ])
      await expect(parseNativeContract('CopilotEvent', event)).rejects.toThrow()
  })
  it.each(['0', '0.30000000000000001', '9007199254740993.1234567890123456789'])(
    'preserves exact accepted decimal %s',
    async (appliedUsd) => {
      await expect(
        parseNativeContract('FinancialFact', {
          accepted: true,
          modelUsd: 'unavailable',
          appliedUsd,
        })
      ).resolves.toMatchObject({ appliedUsd })
    }
  )
  it.each([undefined, 0, '0.0', '+0', '-0', '1e-2', 'not-money'])(
    'rejects invalid accepted decimal %j',
    async (appliedUsd) => {
      await expect(
        parseNativeContract('FinancialFact', {
          accepted: true,
          modelUsd: 'unavailable',
          appliedUsd,
        })
      ).rejects.toThrow()
    }
  )
  it('validates correlation and command-specific outcomes', () => {
    expect(() => assertNativeCorrelation({ requestId: 'stale' }, 'request')).toThrow()
    expect(() =>
      assertNativeCommandResponse('message', {
        requestId: 'request',
        status: 'compacted',
        threadId: 'thread',
        applied: true,
        sourceBoundaryVerified: true,
      })
    ).toThrow()
  })
  it('keeps billing invocation identity out of public pending cards', async () => {
    const pending = { target, stage: 'approval', originalArgs: { entityId: 'workflow' } }
    await expect(parseNativeContract('Pending', pending)).resolves.toEqual(pending)
    for (const field of ['financialBinding', 'financialOccurrence'])
      await expect(parseNativeContract('Pending', { ...pending, [field]: {} })).rejects.toThrow()
  })
})
