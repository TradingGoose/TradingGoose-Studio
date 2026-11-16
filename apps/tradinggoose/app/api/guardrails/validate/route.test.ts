/** @vitest-environment node */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), hallucination: vi.fn(), access: vi.fn() }))
vi.mock('@/app/api/knowledge/utils', () => ({ checkKnowledgeBaseAccess: mocks.access }))
vi.mock('@/lib/auth/hybrid', () => ({ checkSessionOrInternalAuth: mocks.auth }))
vi.mock('@/lib/guardrails/validate_hallucination', () => ({
  validateHallucination: mocks.hallucination,
}))
vi.mock('@/lib/guardrails/validate_pii', () => ({ validatePII: vi.fn() }))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/utils', () => ({ generateRequestId: () => 'request-1' }))

import { POST } from './route'

const request = () =>
  new NextRequest('http://localhost/api/guardrails/validate', {
    method: 'POST',
    body: JSON.stringify({
      validationType: 'hallucination',
      input: 'claim',
      model: 'openai/gpt-4.1',
      knowledgeBaseId: 'kb',
      userId: 'forged',
      workspaceId: 'forged',
    }),
  })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.access.mockResolvedValue({ hasAccess: true, knowledgeBase: { workspaceId: 'workspace' } })
})
describe('hallucination inference actor boundary', () => {
  it('requires an authenticated actor before search or scoring', async () => {
    mocks.auth.mockResolvedValue({ success: false })
    expect((await POST(request())).status).toBe(401)
    expect(mocks.hallucination).not.toHaveBeenCalled()
  })
  it('rejects inaccessible knowledge bases before inference', async () => {
    mocks.auth.mockResolvedValue({ success: true, userId: 'actor' })
    mocks.access.mockResolvedValue({ hasAccess: false })
    expect((await POST(request())).status).toBe(404)
    expect(mocks.hallucination).not.toHaveBeenCalled()
  })
  it('correlates scoring to the authenticated actor and retains search accounting', async () => {
    mocks.auth.mockResolvedValue({
      success: true,
      userId: 'actor',
      workspaceId: 'wrong-session-workspace',
    })
    mocks.hallucination.mockResolvedValue({
      passed: false,
      cost: { status: 'partial', availableTotal: 0.002 },
      tokens: { total: 30 },
    })
    const response = await POST(request())
    expect(mocks.hallucination).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'actor', workspaceId: 'workspace', requestId: 'request-1' })
    )
    expect(await response.json()).toMatchObject({
      output: { cost: { status: 'partial', availableTotal: 0.002 }, tokens: { total: 30 } },
    })
  })
})
