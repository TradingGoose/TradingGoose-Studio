import { CopilotTool } from '@/lib/copilot/registry'
import {
  type BaseServerTool,
  resolveServerWorkflowScope,
} from '@/lib/copilot/tools/server/base-tool'
import { listWorkflowBlockCatalogItems } from '@/lib/copilot/tools/server/blocks/block-mermaid-catalog'
import type {
  GetAgentAccessoryCatalogInputType,
  GetAgentAccessoryCatalogResultType,
} from '@/lib/copilot/tools/shared/schemas'
import { listCustomTools } from '@/lib/custom-tools/operations'
import { mcpService } from '@/lib/mcp/service'
import { createMcpToolId } from '@/lib/mcp/utils'
import { listSkills } from '@/lib/skills/operations'
import { registry as blockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { tools as toolsRegistry } from '@/tools/registry'

type ToolOption = GetAgentAccessoryCatalogResultType['tools'][number]
type SkillOption = GetAgentAccessoryCatalogResultType['skills'][number]

function getOperationOptions(block: BlockConfig): Array<{ id: string; label: string }> {
  const subBlock = block.subBlocks.find((candidate) => candidate.id === 'operation')
  if (!subBlock || !Array.isArray(subBlock.options)) return []
  return subBlock.options.map(({ id, label }) => ({ id, label: label || id }))
}

function resolveToolId(block: BlockConfig, operation?: string): string | undefined {
  if (operation && block.tools.config?.tool) return block.tools.config.tool({ operation })
  if (operation && block.tools.access.includes(operation)) return operation
  return block.tools.access.length === 1 ? block.tools.access[0] : undefined
}

async function getBlockToolOptions(): Promise<ToolOption[]> {
  const availableTypes = new Set(
    (await listWorkflowBlockCatalogItems())
      .filter((item) => item.category === 'tool' && item.blockType !== 'evaluator')
      .map((item) => item.blockType)
  )

  return Object.values(blockRegistry).flatMap((block) => {
    if (!availableTypes.has(block.type) || block.tools.access.length === 0) return []

    const operations = getOperationOptions(block)
    const variants = operations.length ? operations : [undefined]

    return variants.flatMap((operation) => {
      const toolId = resolveToolId(block, operation?.id)
      if (!toolId || !toolsRegistry[toolId]) return []

      return [
        {
          id: operation ? `${block.type}:${operation.id}` : block.type,
          source: 'block' as const,
          title: operation ? `${block.name}: ${operation.label}` : block.name,
          value: {
            type: block.type,
            title: block.name,
            toolId,
            params: {},
            isExpanded: true,
            ...(operation ? { operation: operation.id } : {}),
            usageControl: 'auto',
          },
        },
      ]
    })
  })
}

export const getAgentAccessoryCatalogServerTool: BaseServerTool<
  GetAgentAccessoryCatalogInputType,
  GetAgentAccessoryCatalogResultType
> = {
  name: CopilotTool.get_agent_accessory_catalog,
  async execute(args, context) {
    if (!context?.userId) throw new Error('User context is required')

    const scope = await resolveServerWorkflowScope(args, context)
    if (!scope?.hasAccess || !scope.workspaceId) {
      throw new Error('Workflow not found or access denied')
    }

    const [blockToolOptions, customToolRows, mcpToolRows, skillRows] = await Promise.all([
      getBlockToolOptions(),
      listCustomTools({ workspaceId: scope.workspaceId }),
      mcpService.discoverTools(context.userId, scope.workspaceId),
      listSkills({ workspaceId: scope.workspaceId }),
    ])

    return {
      tools: [
        ...blockToolOptions,
        ...customToolRows.map(
          (tool): ToolOption => ({
            id: `custom:${tool.id}`,
            source: 'custom_tool',
            title: tool.title,
            value: {
              type: 'custom-tool',
              title: tool.title,
              toolId: `custom_${tool.id}`,
              params: {},
              isExpanded: true,
              schema: tool.schema,
              code: tool.code,
              usageControl: 'auto',
            },
          })
        ),
        ...mcpToolRows.map((tool): ToolOption => {
          const toolId = createMcpToolId(tool.serverId, tool.name)
          return {
            id: `mcp:${toolId}`,
            source: 'mcp',
            title: `${tool.name} (${tool.serverName})`,
            value: {
              type: 'mcp',
              title: tool.name,
              toolId,
              params: {
                serverId: tool.serverId,
                toolName: tool.name,
                serverName: tool.serverName,
              },
              isExpanded: true,
              schema: tool.inputSchema,
              usageControl: 'auto',
            },
          }
        }),
      ],
      skills: skillRows.map(
        (skill): SkillOption => ({
          id: skill.id,
          source: 'skill',
          title: skill.name,
          value: {
            skillId: skill.id,
            name: skill.name,
          },
        })
      ),
    }
  },
}
