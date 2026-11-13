import { isToolId, ToolResultSchemas } from '@/lib/copilot/registry'
import { getCopilotToolPolicy } from '@/lib/copilot/tool-policy'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import type { BrowserAssertion, Pending } from './contract'
import { NativeTargetError } from './errors'

/** UI assertions describe local actions. They never attest workflow/deployment/credential effects. */
export function validateNativeBrowserAssertion(pending: Pending, assertion: BrowserAssertion) {
  const name = pending.target.toolName
  if (!isToolId(name)) throw new NativeTargetError('Unknown browser tool', 422)
  const authority = getCopilotToolPolicy(name).resultAuthority
  if (['plan', 'checkoff_todo', 'mark_todo_in_progress'].includes(name)) {
    if (assertion.kind !== 'plan.updated')
      throw new NativeTargetError('Invalid local plan assertion', 422)
    if (
      stableStringifyJsonValue(ToolResultSchemas[name].parse(assertion.data)) !==
      stableStringifyJsonValue(assertion.data)
    )
      throw new NativeTargetError('Local plan assertion does not match its business schema', 422)
    return
  }
  if (name === 'sleep') {
    if (assertion.kind !== 'timer.completed')
      throw new NativeTargetError('Invalid local timer assertion', 422)
    if (
      stableStringifyJsonValue(ToolResultSchemas.sleep.parse(assertion.data)) !==
      stableStringifyJsonValue(assertion.data)
    )
      throw new NativeTargetError('Local timer assertion does not match its business schema', 422)
    return
  }
  if (authority !== 'browser_ui' && authority !== 'workflow_deployment') {
    throw new NativeTargetError('This tool requires authoritative Studio readback', 422)
  }
  if (
    assertion.kind !== 'ui.opened' ||
    (name === 'deploy_workflow' && pending.originalArgs.action === 'undeploy')
  ) {
    throw new NativeTargetError('Only a dialog-opened acknowledgement is permitted', 422)
  }
  const data = assertion.data
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    data.opened !== true ||
    (data.surface !== undefined && typeof data.surface !== 'string') ||
    (data.message !== undefined && typeof data.message !== 'string') ||
    Object.keys(data).some((key) => !['opened', 'surface', 'message'].includes(key))
  ) {
    throw new NativeTargetError('UI acknowledgement cannot assert a business result', 422)
  }
}
