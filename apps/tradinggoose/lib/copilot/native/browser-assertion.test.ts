import { describe, expect, it } from 'vitest'
import { validateNativeBrowserAssertion } from './browser-assertion'
import type { JsonObject, Pending } from './contract'

function pending(toolName: string, originalArgs: JsonObject = {}): Pending {
  return {
    target: {
      toolName,
      toolCallId: 'call',
      threadId: 'thread',
      resourceId: 'resource',
      runId: 'run',
    },
    originalArgs,
    stage: 'result',
    financialBinding: {
      namespace: 'billing',
      key: 'key',
      fingerprint: 'fp',
      actorUserId: 'actor',
      workspaceId: null,
      workflowId: null,
      runId: 'run',
      purpose: 'copilot',
    },
    financialOccurrence: { stepNumber: 1, retryCount: 0 },
  }
}
describe('browser assertions cannot become authoritative business results', () => {
  it.each(['run_workflow', 'gdrive_request_access', 'create_workflow', 'read_workflow'])(
    'requires Studio result proof for %s',
    (toolName) => {
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), {
          kind: 'selection.submitted',
          data: { success: true, granted: true },
        })
      ).toThrow('authoritative Studio')
    }
  )
  it('keeps local plan and timer assertions within their actual schemas', () => {
    expect(() =>
      validateNativeBrowserAssertion(pending('plan'), {
        kind: 'plan.updated',
        data: { todoList: [] },
      })
    ).not.toThrow()
    expect(() =>
      validateNativeBrowserAssertion(pending('sleep'), {
        kind: 'timer.completed',
        data: { success: true, seconds: 1 },
      })
    ).not.toThrow()
    expect(() =>
      validateNativeBrowserAssertion(pending('plan'), {
        kind: 'plan.updated',
        data: { granted: true },
      })
    ).toThrow('business schema')
  })
  it.each(['oauth_request_access', 'deploy_workflow'])(
    'only describes opened UI for %s and denies fabricated grants/deployments',
    (toolName) => {
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), {
          kind: 'ui.opened',
          data: { opened: true, surface: 'settings' },
        })
      ).not.toThrow()
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), {
          kind: 'ui.opened',
          data: { opened: true, granted: true, isDeployed: true },
        })
      ).toThrow('cannot assert')
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), {
          kind: 'ui.opened',
          data: { opened: true, surface: { granted: true } },
        })
      ).toThrow('cannot assert')
    }
  )
  it('undeployment requires authoritative readback instead of UI acknowledgement', () => {
    expect(() =>
      validateNativeBrowserAssertion(pending('deploy_workflow', { action: 'undeploy' }), {
        kind: 'ui.opened',
        data: { opened: true },
      })
    ).toThrow('Only a dialog')
  })
})
