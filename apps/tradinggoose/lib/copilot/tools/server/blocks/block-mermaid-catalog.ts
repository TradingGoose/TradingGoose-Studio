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
      'Keep child blocks inside the loop container. External edges enter through the loop boundary, and child outputs reconnect to the loop end before leaving.',
    triggerAllowed: false,
  },
  parallel: {
    blockName: 'Parallel',
    blockDescription: 'Control-flow container for running child branches in parallel.',
    bestPractices:
      'Keep child blocks inside the parallel container. External edges enter through the parallel boundary, and child outputs reconnect to the parallel end before leaving.',
    triggerAllowed: false,
  },
}

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
