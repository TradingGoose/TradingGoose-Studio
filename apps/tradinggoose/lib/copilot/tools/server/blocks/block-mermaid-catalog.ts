import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { registry as blockRegistry } from '@/blocks/registry'
import { AuthMode, type BlockConfig } from '@/blocks/types'
import { tools as toolsRegistry } from '@/tools/registry'
import type {
  BlockMermaidCatalogItemType,
  BlockMermaidOperationType,
  BlockMermaidProfileType,
} from '@/lib/copilot/tools/shared/schemas'

type BlockAuthType = 'OAuth' | 'API Key' | 'Bot Token'

type BlockRequiredCredentials = {
  type: 'oauth' | 'api_key' | 'bot_token'
  service?: string
  description: string
}

type BlockOperationSummary = BlockMermaidOperationType
type BlockCatalogItem = BlockMermaidCatalogItemType
type BlockProfile = BlockMermaidProfileType
type BlockSubBlockSummary = NonNullable<BlockProfile['subBlocks']>[number]

type BlockCatalogDefinition = {
  blockType: string
  blockName: string
  blockDescription?: string
  bestPractices?: string
  triggerAllowed?: boolean
  authType?: BlockAuthType
  requiredCredentials?: BlockRequiredCredentials
  yamlDocumentation?: string
  operationChoices: Array<{
    id: string
    name: string
    description?: string
  }>
}

const SPECIAL_BLOCK_DEFINITIONS: Record<string, Omit<BlockCatalogDefinition, 'blockType' | 'yamlDocumentation' | 'operationChoices'>> = {
  loop: {
    blockName: 'Loop',
    blockDescription: 'Control-flow container for iterating over child blocks.',
    bestPractices:
      'Keep child blocks inside the loop container. Incoming edges enter through Loop Start. Child outputs reconnect to Loop End before leaving the container.',
    triggerAllowed: false,
  },
  parallel: {
    blockName: 'Parallel',
    blockDescription: 'Control-flow container for running child branches in parallel.',
    bestPractices:
      'Keep child blocks inside the parallel container. Incoming edges enter through Parallel Start. Child outputs reconnect to Parallel End before leaving the container.',
    triggerAllowed: false,
  },
}

const NON_INPUT_SUBBLOCK_TYPES = new Set(['text', 'trigger-save', 'schedule-config'])

function resolveAuthType(authMode: AuthMode | undefined): BlockAuthType | undefined {
  if (!authMode) return undefined
  if (authMode === AuthMode.OAuth) return 'OAuth'
  if (authMode === AuthMode.ApiKey) return 'API Key'
  if (authMode === AuthMode.BotToken) return 'Bot Token'
  return undefined
}

function buildRequiredCredentials(
  authType: BlockAuthType | undefined,
  blockType: string,
  blockName: string
): BlockRequiredCredentials | undefined {
  if (!authType) return undefined
  if (authType === 'OAuth') {
    return {
      type: 'oauth',
      service: blockType,
      description: `OAuth authentication required for ${blockName}.`,
    }
  }
  if (authType === 'API Key') {
    return {
      type: 'api_key',
      description: `API key authentication required for ${blockName}.`,
    }
  }
  return {
    type: 'bot_token',
    description: `Bot token authentication required for ${blockName}.`,
  }
}

function readBlockDocumentation(blockType: string): string | undefined {
  try {
    const workingDir = process.cwd()
    const isInTradingGooseApp =
      workingDir.endsWith('/apps/tradinggoose') || workingDir.endsWith('\\apps\\tradinggoose')
    const basePath = isInTradingGooseApp ? join(workingDir, '..', '..') : workingDir
    const docPath = join(
      basePath,
      'apps',
      'docs',
      'content',
      'docs',
      'yaml',
      'blocks',
      `${blockType}.mdx`
    )

    if (!existsSync(docPath)) {
      return undefined
    }

    return readFileSync(docPath, 'utf-8')
  } catch {
    return undefined
  }
}

function resolveOperationChoices(
  blockConfig: BlockConfig | undefined
): BlockCatalogDefinition['operationChoices'] {
  const operationSubBlock = blockConfig?.subBlocks?.find((subBlock) => subBlock.id === 'operation')
  if (!operationSubBlock || !Array.isArray(operationSubBlock.options)) {
    return []
  }

  return operationSubBlock.options.map((option) => {
    const operationId = typeof option === 'object' ? option.id : option
    const operationName = typeof option === 'object' ? option.label || option.id : option
    let description: string | undefined

    try {
      const toolSelector = blockConfig?.tools?.config?.tool
      if (typeof toolSelector === 'function') {
        const toolId = toolSelector({ operation: operationId })
        const tool = typeof toolId === 'string' ? toolsRegistry[toolId] : undefined
        description = tool?.description
      }
    } catch {
      description = undefined
    }

    return {
      id: operationId,
      name: operationName || operationId,
      ...(description ? { description } : {}),
    }
  })
}

function resolveSubBlockOptions(subBlock: BlockConfig['subBlocks'][number]) {
  const options = typeof subBlock.options === 'function' ? subBlock.options() : subBlock.options
  if (!Array.isArray(options) || options.length === 0) {
    return undefined
  }

  return options.map((option) => ({
    id: option.id,
    label: option.label || option.id,
  }))
}

function buildSubBlockSummaries(
  blockConfig: BlockConfig | undefined
): BlockProfile['subBlocks'] | undefined {
  if (!blockConfig?.subBlocks?.length) {
    return undefined
  }

  const subBlocks: BlockSubBlockSummary[] = blockConfig.subBlocks.map((subBlock) => {
    const options = resolveSubBlockOptions(subBlock)

    return {
      id: subBlock.id,
      ...(subBlock.title ? { title: subBlock.title } : {}),
      type: subBlock.type,
      ...(subBlock.mode ? { mode: subBlock.mode } : {}),
      ...(typeof subBlock.required === 'boolean' ? { required: subBlock.required } : {}),
      ...(subBlock.description ? { description: subBlock.description } : {}),
      ...(subBlock.placeholder ? { placeholder: subBlock.placeholder } : {}),
      ...(subBlock.canonicalParamId ? { canonicalParamId: subBlock.canonicalParamId } : {}),
      ...(subBlock.language ? { language: subBlock.language } : {}),
      ...(subBlock.generationType ? { generationType: subBlock.generationType } : {}),
      ...(subBlock.defaultValue !== undefined ? { defaultValue: subBlock.defaultValue } : {}),
      ...(options ? { options } : {}),
    }
  })

  return subBlocks.length > 0 ? subBlocks : undefined
}

function blockHasInputSurface(blockConfig: BlockConfig | undefined): boolean {
  if (!blockConfig) {
    return false
  }

  if (Object.keys(blockConfig.inputs ?? {}).length > 0) {
    return true
  }

  return (blockConfig.subBlocks ?? []).some(
    (subBlock) => !NON_INPUT_SUBBLOCK_TYPES.has(subBlock.type)
  )
}

function buildInputReferenceGrammar(
  blockType: string,
  blockConfig: BlockConfig | undefined
): BlockProfile['inputReferenceGrammar'] {
  if (!blockHasInputSurface(blockConfig)) {
    return undefined
  }

  return {
    hardRequirement: true,
    summary:
      'All input-capable fields on this block must use TradingGoose reference grammar exactly. Resolve tags with the listed source tools, then copy the returned tag verbatim instead of inventing placeholder syntax.',
    workflowOutputs: {
      syntax: '<block.output>',
      summary:
        'Copy the exact `path` returned by `get_block_outputs` or `get_block_upstream_references`, such as `agent.content`, and wrap it once as `<agent.content>`. Use the returned `type` to choose valid fields. Do not add `block.`, `previousBlock`, `output`, or workflow block ids.',
      examples: ['<agent.content>', '<historical_data.close>'],
      sourceTools: ['get_block_outputs', 'get_block_upstream_references'],
    },
    workflowVariables: {
      syntax: '<variable.name>',
      summary:
        'Copy the exact workflow variable tag, such as `variable.riskLimit`, and wrap it once as `<variable.riskLimit>`.',
      examples: ['<variable.riskLimit>', '<variable.companyName>'],
      sourceTools: ['get_global_workflow_variables'],
    },
    environmentVariables: {
      syntax: '{{ENV_VAR_NAME}}',
      summary:
        'Reference environment variables with double curly braces and the exact environment variable name.',
      examples: ['{{OPENAI_API_KEY}}', '{{SERVICE_API_KEY}}'],
      sourceTools: ['get_environment_variables'],
    },
    ...(blockType === 'function'
        ? {
          blockSpecificRules: [
            {
              title: 'Use built-in indicators with full Historical Data output',
              summary:
                'Call built-in indicators with `indicator.<ID>(marketSeries)` and pass the full Historical Data output object, not `<historical_data.close>`. The optional second argument must be an object. Use saved indicator input titles as keys, or pass them under `inputs`. Use `indicator.list()` if the built-in ID is unknown.',
              examples: [
                'await indicator.RSI(<historical_data>)',
                'await indicator.RSI(<historical_data>, { Length: 7 })',
                "await indicator.MACD(<historical_data>, { 'Fast Length': 12, 'Slow Length': 26, 'Signal Length': 9 })",
              ],
            },
            {
              title: 'Do not author custom Pine indicators inside Function blocks',
              summary:
                'Do not define indicators with `indicator(...)`, PineTS, or `pinets` imports inside Function blocks. Use the dedicated indicator authoring surface for custom indicators.',
            },
          ],
        }
      : {}),
  }
}

function resolveBlockCatalogDefinition(blockType: string): BlockCatalogDefinition | null {
  const specialDefinition = SPECIAL_BLOCK_DEFINITIONS[blockType]
  if (specialDefinition) {
    return {
      blockType,
      operationChoices: [],
      yamlDocumentation: readBlockDocumentation(blockType),
      ...specialDefinition,
    }
  }

  const blockConfig = blockRegistry[blockType]
  if (!blockConfig || blockConfig.hideFromToolbar) {
    return null
  }

  const authType = resolveAuthType(blockConfig.authMode)
  return {
    blockType,
    blockName: blockConfig.name || blockType,
    blockDescription: blockConfig.longDescription || blockConfig.description || undefined,
    bestPractices: blockConfig.bestPractices || undefined,
    triggerAllowed: 'triggerAllowed' in blockConfig ? !!blockConfig.triggerAllowed : false,
    authType,
    requiredCredentials: buildRequiredCredentials(authType, blockType, blockConfig.name || blockType),
    yamlDocumentation: readBlockDocumentation(blockType),
    operationChoices: resolveOperationChoices(blockConfig),
  }
}

async function loadWorkflowBlockMermaidShape(params: {
  blockType: string
  blockName: string
  operation?: string
}) {
  const { buildWorkflowBlockMermaidShape } = await import('@/lib/workflows/block-mermaid-contract')
  return buildWorkflowBlockMermaidShape(params)
}

async function buildOperationSummaries(
  blockType: string,
  blockName: string,
  operationChoices: BlockCatalogDefinition['operationChoices']
): Promise<BlockOperationSummary[]> {
  return Promise.all(
    operationChoices.map(async (operation) => ({
      ...operation,
      ...(await loadWorkflowBlockMermaidShape({
        blockType,
        blockName,
        operation: operation.id,
      })),
    }))
  )
}

export async function listWorkflowBlockCatalogItems(): Promise<BlockCatalogItem[]> {
  const blockTypes = [
    ...Object.keys(blockRegistry).filter((blockType) => !blockRegistry[blockType]?.hideFromToolbar),
    ...Object.keys(SPECIAL_BLOCK_DEFINITIONS),
  ]

  const items = await Promise.all(
    Array.from(new Set(blockTypes))
      .sort((left, right) => left.localeCompare(right))
      .map(async (blockType) => {
      const definition = resolveBlockCatalogDefinition(blockType)
      if (!definition) {
        return null
      }

      const shape = await loadWorkflowBlockMermaidShape({
        blockType,
        blockName: definition.blockName,
      })

      return {
        blockType,
        blockName: definition.blockName,
        ...(definition.blockDescription ? { blockDescription: definition.blockDescription } : {}),
        ...(definition.triggerAllowed !== undefined
          ? { triggerAllowed: definition.triggerAllowed }
          : {}),
        mermaidContract: shape.mermaidContract,
        ...(definition.operationChoices.length > 0
          ? { operationIds: definition.operationChoices.map((operation) => operation.id) }
          : {}),
      }
    })
  )

  return items.filter((item): item is BlockCatalogItem => item !== null)
}

export async function getWorkflowBlockOperationSummaries(
  blockType: string
): Promise<BlockOperationSummary[]> {
  const definition = resolveBlockCatalogDefinition(blockType)
  if (!definition) {
    throw new Error(`Block not found: ${blockType}`)
  }

  return buildOperationSummaries(blockType, definition.blockName, definition.operationChoices)
}

export async function getWorkflowBlockProfile(blockType: string): Promise<BlockProfile> {
  const definition = resolveBlockCatalogDefinition(blockType)
  if (!definition) {
    throw new Error(`Block not found: ${blockType}`)
  }
  const blockConfig = blockRegistry[blockType]
  const subBlocks = buildSubBlockSummaries(blockConfig)
  const inputReferenceGrammar = buildInputReferenceGrammar(blockType, blockConfig)

  const shape = await loadWorkflowBlockMermaidShape({
    blockType,
    blockName: definition.blockName,
  })

  return {
    blockType,
    blockName: definition.blockName,
    ...(definition.blockDescription ? { blockDescription: definition.blockDescription } : {}),
    ...(definition.bestPractices ? { bestPractices: definition.bestPractices } : {}),
    ...(definition.triggerAllowed !== undefined ? { triggerAllowed: definition.triggerAllowed } : {}),
    ...(definition.authType ? { authType: definition.authType } : {}),
    ...(definition.requiredCredentials
      ? { requiredCredentials: definition.requiredCredentials }
      : {}),
    ...(definition.yamlDocumentation ? { yamlDocumentation: definition.yamlDocumentation } : {}),
    ...(subBlocks ? { subBlocks } : {}),
    ...(inputReferenceGrammar ? { inputReferenceGrammar } : {}),
    ...shape,
    ...(definition.operationChoices.length > 0
      ? {
          operations: await buildOperationSummaries(
            blockType,
            definition.blockName,
            definition.operationChoices
          ),
        }
      : {}),
  }
}
