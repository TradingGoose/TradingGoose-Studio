import { COPILOT_TOOLS } from '../services/tools'
import type { AiRouterTool } from '../llm/ai-router'
import type { CopilotModeDefinition } from '../modes'

export function toolsForMode(mode: CopilotModeDefinition) {
  const allowed = mode.allowedToolNames ? new Set(mode.allowedToolNames) : null
  return COPILOT_TOOLS.filter((tool) => {
    if (allowed) {
      return allowed.has(tool.name)
    }
    return true
  })
}

export function buildToolingInstruction(
  mode: CopilotModeDefinition,
  allowedTools: typeof COPILOT_TOOLS
): string {
  const toolLines = allowedTools.map((t) => {
    const ruleText = t.rules ? ` Rules: ${t.rules}` : ''
    return `- ${t.name}: ${t.description}. Args: ${t.arguments}.${ruleText}`
  })

  const sections: string[] = []
  sections.push(`Mode: ${mode.id.toUpperCase()}`)
  if (mode.toolInstructions?.length) {
    sections.push(mode.toolInstructions.join('\n'))
  }

  sections.push('Allowed tools:\n' + toolLines.join('\n'))

  return sections.join('\n\n')
}

export function buildToolsForAiRouter(tools: typeof COPILOT_TOOLS): AiRouterTool[] {
  // OpenAI-style tool definitions with permissive schemas to encourage function calling
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    },
  }))
}
