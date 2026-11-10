import coverage from './native/contract/tool-coverage.json'
import type { ToolId } from './registry'

const policies = new Map(coverage.tools.map((tool) => [tool.name, tool]))

/** Accepted coverage supplies classification once; implementations and business validators stay canonical Studio code. */
export function getCopilotToolPolicy(name: ToolId) {
  const policy = policies.get(name)
  if (!policy || (policy.execution !== 'client' && policy.execution !== 'server')) {
    throw new Error(`Missing accepted Copilot tool policy: ${name}`)
  }
  return {
    execution: policy.execution,
    gated: policy.uiGated,
    mcpExposed: policy.mcpExposed,
    resultAuthority: policy.resultAuthority,
  }
}
