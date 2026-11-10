import { decodeJwt, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type CopilotToolResultEvidence,
  createCopilotToolResultProof,
  verifyCopilotToolResultProof,
} from '@/lib/copilot/result-proof'

const testSecret = 'local-test-copilot-result-proof-secret-1234'
vi.mock('@/lib/env', () => ({
  env: { INTERNAL_API_SECRET: 'local-test-copilot-result-proof-secret-1234' },
}))

const evidence: CopilotToolResultEvidence = {
  binding: {
    actorId: 'actor-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    resourceId: 'copilot-resource-1',
    threadId: 'thread-1',
    runId: 'native-run-1',
    toolCallId: 'native-tool-call-1',
    toolName: 'edit_workflow',
    financialRootId: 'financial-root-1',
  },
  originalArgs: { entityId: 'workflow-1', entityDocument: 'flowchart TD\n  A --> B\n' },
  result: { success: true, revision: 2, output: [' exact text\n', '', 'duplicate', 'duplicate'] },
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
})
afterEach(() => vi.useRealTimers())

async function alteredProof(changes: Record<string, unknown>, algorithm = 'HS256') {
  const payload = { ...decodeJwt(await createCopilotToolResultProof(evidence)), ...changes }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: algorithm })
    .sign(new TextEncoder().encode(testSecret))
}

describe('Copilot final business result proof', () => {
  it('binds only digests and references, with purpose-specific five-minute provenance', async () => {
    const proof = await createCopilotToolResultProof(evidence)
    await expect(verifyCopilotToolResultProof(proof, evidence)).resolves.toBeUndefined()
    const payload = decodeJwt(proof)
    expect(payload).toMatchObject({
      ...evidence.binding,
      type: 'copilot-tool-result',
      iss: 'tradinggoose-studio',
      aud: 'tradinggoose-copilot-result',
    })
    expect(Number(payload.exp) - Number(payload.iat)).toBe(300)
    expect(payload.argsDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.resultDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(payload)).not.toContain('flowchart')
    expect(JSON.stringify(payload)).not.toContain('exact text')
  })

  it('preserves genuine personal null scope and refuses null/string scope tampering', async () => {
    const personal = {
      ...evidence,
      binding: {
        ...evidence.binding,
        workspaceId: null,
        tenantId: JSON.stringify(['personal', evidence.binding.actorId]),
        resourceId: JSON.stringify([
          'copilot',
          'personal',
          evidence.binding.actorId,
          evidence.binding.actorId,
          null,
        ]),
      },
    }
    const proof = await createCopilotToolResultProof(personal)
    expect(decodeJwt(proof).workspaceId).toBeNull()
    await expect(verifyCopilotToolResultProof(proof, personal)).resolves.toBeUndefined()
    await expect(verifyCopilotToolResultProof(proof, evidence)).rejects.toThrow()
    const workspaceProof = await createCopilotToolResultProof(evidence)
    await expect(verifyCopilotToolResultProof(workspaceProof, personal)).rejects.toThrow()
  })

  it.each(Object.keys(evidence.binding))('rejects a proof reused for another %s', async (key) => {
    const proof = await createCopilotToolResultProof(evidence)
    const value = key === 'toolName' ? 'read_workflow' : 'different'
    await expect(
      verifyCopilotToolResultProof(proof, {
        ...evidence,
        binding: { ...evidence.binding, [key]: value },
      })
    ).rejects.toThrow()
  })

  it('accepts object key reordering while preserving string bytes, arrays and duplicate order', async () => {
    const proof = await createCopilotToolResultProof(evidence)
    await expect(
      verifyCopilotToolResultProof(proof, {
        ...evidence,
        result: {
          output: [' exact text\n', '', 'duplicate', 'duplicate'],
          revision: 2,
          success: true,
        },
      })
    ).resolves.toBeUndefined()
    for (const result of [
      { success: true, revision: 2, output: ['exact text\n', '', 'duplicate', 'duplicate'] },
      { success: true, revision: 2, output: ['', ' exact text\n', 'duplicate', 'duplicate'] },
      { success: true, revision: 2, output: [' exact text\n', '', 'duplicate'] },
    ]) {
      await expect(verifyCopilotToolResultProof(proof, { ...evidence, result })).rejects.toThrow()
    }
    await expect(
      verifyCopilotToolResultProof(proof, { ...evidence, originalArgs: { entityId: 'other' } })
    ).rejects.toThrow()
  })

  it('preserves nested business keys including resumeData and prototype property names', async () => {
    const exact = {
      ...evidence,
      originalArgs: JSON.parse(
        '{"body":{"resumeData":false,"__proto__":{"x":1},"constructor":"data"}}'
      ),
    }
    const proof = await createCopilotToolResultProof(exact)
    await expect(verifyCopilotToolResultProof(proof, exact)).resolves.toBeUndefined()
    await expect(
      verifyCopilotToolResultProof(proof, {
        ...exact,
        originalArgs: { body: { resumeData: false } },
      })
    ).rejects.toThrow()
  })

  it.each(['resumeData', 'suspendedToolCallId', 'suspendedToolRunId', '_background'])(
    'rejects reserved original root %s even when falsy or inherited',
    async (key) => {
      for (const value of [null, false, 0, '', {}]) {
        await expect(
          createCopilotToolResultProof({ ...evidence, originalArgs: { [key]: value } })
        ).rejects.toThrow(/Native execution/)
      }
      await expect(
        createCopilotToolResultProof({ ...evidence, originalArgs: Object.create({ [key]: null }) })
      ).rejects.toThrow(/Native execution/)
    }
  )

  it.each([
    { result: { requiresReview: true, reviewToken: 'preview' } },
    { result: undefined },
    { result: { omitted: undefined } },
    { result: [undefined] },
    { result: new Array(1) },
    { result: new Date() },
    { result: { number: Number.NaN } },
    { result: { number: Number.POSITIVE_INFINITY } },
    { result: { number: 1n } },
    { result: Object.create({ success: true }) },
    {
      result: {
        get value() {
          throw new Error('Getter must not run')
        },
      },
    },
    { originalArgs: null },
    { originalArgs: [] },
  ])('refuses previews and data that JSON would silently change', async (changes) => {
    await expect(createCopilotToolResultProof({ ...evidence, ...changes })).rejects.toThrow()
  })

  it('rejects circular, symbolic and hidden properties without collapsing them to another result', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    for (const result of [
      cyclic,
      { [Symbol('hidden')]: 'value' },
      Object.defineProperty({}, 'hidden', { value: true }),
    ]) {
      await expect(createCopilotToolResultProof({ ...evidence, result })).rejects.toThrow()
    }
  })

  it.each([
    { type: 'internal' },
    { iss: 'tradinggoose-internal' },
    { aud: 'tradinggoose-api' },
    { aud: ['tradinggoose-copilot-result'] },
    { exp: undefined },
    { iat: undefined },
    { extra: 'unrecognized' },
    { argsDigest: '0000' },
  ])('rejects signed wrong-purpose or malformed claims: %j', async (changes) => {
    await expect(
      verifyCopilotToolResultProof(await alteredProof(changes), evidence)
    ).rejects.toThrow()
  })

  it('rejects wrong algorithm, excessive lifetime, future issued time, expiry and signature mutation', async () => {
    await expect(
      verifyCopilotToolResultProof(await alteredProof({}, 'HS384'), evidence)
    ).rejects.toThrow()
    const now = Math.floor(Date.now() / 1000)
    await expect(
      verifyCopilotToolResultProof(await alteredProof({ exp: now + 301 }), evidence)
    ).rejects.toThrow()
    await expect(
      verifyCopilotToolResultProof(await alteredProof({ iat: now + 1, exp: now + 301 }), evidence)
    ).rejects.toThrow()
    const proof = await createCopilotToolResultProof(evidence)
    const parts = proof.split('.')
    parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`
    await expect(verifyCopilotToolResultProof(parts.join('.'), evidence)).rejects.toThrow()
    vi.advanceTimersByTime(300_000)
    await expect(verifyCopilotToolResultProof(proof, evidence)).rejects.toThrow()
  })

  it('keeps concurrent proof bindings isolated without a current-grant singleton', async () => {
    const second = {
      ...evidence,
      binding: { ...evidence.binding, actorId: 'actor-2', runId: 'run-2' },
    }
    const [one, two] = await Promise.all([
      createCopilotToolResultProof(evidence),
      createCopilotToolResultProof(second),
    ])
    await Promise.all([
      verifyCopilotToolResultProof(one, evidence),
      verifyCopilotToolResultProof(two, second),
    ])
    await expect(verifyCopilotToolResultProof(one, second)).rejects.toThrow()
    await expect(verifyCopilotToolResultProof(two, evidence)).rejects.toThrow()
  })
})
