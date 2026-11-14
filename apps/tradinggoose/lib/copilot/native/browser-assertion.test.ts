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
  }
}
describe('browser assertions cannot become authoritative business results', () => {
  it.each(['run_workflow', 'gdrive_request_access', 'create_workflow', 'read_workflow'])(
    'requires authoritative Studio readback for %s',
    (toolName) => {
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), {
          kind: 'ui.opened',
          data: { success: true, granted: true },
        })
      ).toThrow('authoritative Studio')
    }
  )
  it.each([
    ['plan', { todoList: [] }],
    ['checkoff_todo', { id: 'todo' }],
    ['mark_todo_in_progress', { id: 'todo' }],
    ['sleep', { success: true, seconds: 1 }],
  ] satisfies [string, JsonObject][])(
    'keeps %s assertions within their kind and business schema',
    (toolName, data) => {
      const kind = toolName === 'sleep' ? 'timer.completed' : 'plan.updated'
      expect(() => validateNativeBrowserAssertion(pending(toolName), { kind, data })).not.toThrow()
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), { kind: 'ui.opened', data })
      ).toThrow('Invalid local')
      expect(() =>
        validateNativeBrowserAssertion(pending(toolName), {
          kind,
          data: { ...data, granted: true },
        })
      ).toThrow('business schema')
    }
  )
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
