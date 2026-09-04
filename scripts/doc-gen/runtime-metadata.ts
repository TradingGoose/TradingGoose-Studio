import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getAllBlocks } from '../../apps/tradinggoose/blocks/registry'
import type {
  BlockConfig as RuntimeBlockConfig,
  SubBlockCondition,
  SubBlockConfig,
} from '../../apps/tradinggoose/blocks/types'
import { tools as registeredTools } from '../../apps/tradinggoose/tools/registry'
import type { ToolConfig } from '../../apps/tradinggoose/tools/types'
import { TRIGGER_REGISTRY } from '../../apps/tradinggoose/triggers/registry'
import type { TriggerConfig as RuntimeTriggerConfig } from '../../apps/tradinggoose/triggers/types'
import { shouldGenerateToolDoc } from './doc-pages'
import type {
  BlockConfig,
  DocCondition,
  DocSubBlock,
  ToolDocSource,
  ToolInfo,
  TriggerConfig,
} from './types'
import { appendSentence, describeVisibilityCondition } from './utils'

const AI_DISPATCH_TOOL_IDS = new Set([
  'anthropic_chat',
  'deepseek_chat',
  'deepseek_reasoner',
  'google_chat',
  'openai_chat',
  'xai_chat',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

function resolveMetadataFactory<T>(
  factory: () => T,
  ownerType: string | undefined,
  subBlockId: string,
  field: 'condition' | 'options' | 'required' | 'value'
): T {
  try {
    return factory()
  } catch (error) {
    throw new Error(
      `${ownerType ?? 'block'}.${subBlockId} ${field} could not be resolved: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function copyCondition(condition: SubBlockCondition): DocCondition {
  return {
    field: condition.field,
    value: condition.value,
    ...(condition.not === undefined ? {} : { not: condition.not }),
    ...(condition.and
      ? {
          and: Array.isArray(condition.and)
            ? condition.and.map(copyCondition)
            : copyCondition(condition.and),
        }
      : {}),
  }
}

function sanitizeSubBlock(
  subBlock: SubBlockConfig,
  resolveFactories = false,
  ownerType?: string
): DocSubBlock | null {
  if (
    subBlock.hidden ||
    subBlock.hideFromPreview ||
    subBlock.readOnly ||
    subBlock.type === 'trigger-save' ||
    subBlock.type === 'text'
  ) {
    return null
  }

  const result: DocSubBlock = { id: subBlock.id, type: subBlock.type }
  const stringFields = [
    'title',
    'layout',
    'placeholder',
    'description',
    'language',
    'provider',
  ] as const
  const booleanFields = ['password'] as const
  const numberFields = ['min', 'max', 'step'] as const

  for (const field of stringFields) {
    const value = subBlock[field]
    if (typeof value === 'string') Object.assign(result, { [field]: value })
  }
  for (const field of booleanFields) {
    const value = subBlock[field]
    if (typeof value === 'boolean') Object.assign(result, { [field]: value })
  }
  for (const field of numberFields) {
    const value = subBlock[field]
    if (typeof value === 'number') Object.assign(result, { [field]: value })
  }

  let required = subBlock.required
  const hasRequiredFactory = resolveFactories && typeof required === 'function'
  if (hasRequiredFactory) {
    required = resolveMetadataFactory(
      required as () => SubBlockCondition,
      ownerType,
      subBlock.id,
      'required'
    )
  }
  if (typeof required === 'boolean') {
    result.required = required
  } else if (isRecord(required) && typeof required.field === 'string') {
    result.requiredCondition = copyCondition(required as unknown as SubBlockCondition)
  } else if (hasRequiredFactory) {
    throw new Error(`${ownerType ?? 'block'}.${subBlock.id} required did not return a condition`)
  }

  let defaultValue: unknown = subBlock.defaultValue
  const hasValueFactory =
    defaultValue === undefined &&
    resolveFactories &&
    typeof subBlock.value === 'function' &&
    subBlock.value.length === 0
  if (hasValueFactory) {
    defaultValue = resolveMetadataFactory(
      subBlock.value as unknown as () => unknown,
      ownerType,
      subBlock.id,
      'value'
    )
  }
  if (
    typeof defaultValue === 'string' ||
    typeof defaultValue === 'number' ||
    typeof defaultValue === 'boolean'
  ) {
    result.defaultValue = defaultValue
  } else if (hasValueFactory) {
    throw new Error(`${ownerType ?? 'block'}.${subBlock.id} value is not serializable`)
  }

  const hasOptionsFactory = resolveFactories && typeof subBlock.options === 'function'
  const options = hasOptionsFactory
    ? resolveMetadataFactory(subBlock.options as () => unknown, ownerType, subBlock.id, 'options')
    : subBlock.options
  if (hasOptionsFactory && !Array.isArray(options)) {
    throw new Error(`${ownerType ?? 'block'}.${subBlock.id} options did not return an array`)
  }
  if (Array.isArray(options) && options.length > 0) {
    result.options = options.map((option) => {
      if (!isRecord(option) || typeof option.id !== 'string' || typeof option.label !== 'string') {
        throw new Error(`${ownerType ?? 'block'}.${subBlock.id} options contain an invalid entry`)
      }
      return { id: option.id, label: option.label }
    })
  }

  let condition = subBlock.condition
  if (resolveFactories && typeof condition === 'function') {
    condition = resolveMetadataFactory(condition, ownerType, subBlock.id, 'condition')
  }
  if (isRecord(condition) && typeof condition.field === 'string') {
    result.condition = copyCondition(condition as unknown as SubBlockCondition)
  }

  return result
}

function sanitizeBlock(block: RuntimeBlockConfig, resolveOperations = true): BlockConfig {
  const sourceSubBlocks = block.subBlocks.filter((subBlock) => subBlock.mode !== 'trigger')
  const subBlocks = sourceSubBlocks
    .map((subBlock) => sanitizeSubBlock(subBlock, resolveOperations, block.type))
    .filter((subBlock): subBlock is DocSubBlock => subBlock !== null)
  const datadogSeries =
    block.type === 'datadog' ? subBlocks.find(({ id }) => id === 'series') : undefined
  if (datadogSeries?.placeholder) {
    datadogSeries.placeholder = datadogSeries.placeholder.replace(
      /("timestamp":\s*)\d+/,
      (_, prefix) => `${prefix}1700000000`
    )
  }
  const staticOptionFieldIds = new Set(
    sourceSubBlocks.filter((subBlock) => Array.isArray(subBlock.options)).map(({ id }) => id)
  )
  const operationField = resolveOperations
    ? findOperationField(subBlocks, staticOptionFieldIds)
    : undefined

  return {
    type: block.type,
    name: block.name,
    description: block.description,
    longDescription: block.longDescription,
    category: block.category,
    bgColor: block.bgColor,
    inputs: block.inputs,
    outputs: block.outputs,
    tools: { access: [...block.tools.access] },
    subBlocks,
    operationFieldId: operationField?.id,
    operationToolMap: operationField ? resolveOperationToolMap(block, operationField) : undefined,
  }
}

function findOperationField(
  subBlocks: DocSubBlock[],
  staticOptionFieldIds: Set<string>
): DocSubBlock | undefined {
  const counts = new Map<string, number>()
  for (const subBlock of subBlocks) {
    const field = subBlock.condition?.field
    if (field) counts.set(field, (counts.get(field) ?? 0) + 1)
  }

  const field = [...counts]
    .filter(([id]) => staticOptionFieldIds.has(id))
    .sort((left, right) => right[1] - left[1])[0]?.[0]
  return subBlocks.find(
    (subBlock) => subBlock.id === field && subBlock.options && subBlock.options.length > 1
  )
}

function resolveOperationToolMap(
  block: RuntimeBlockConfig,
  operationField: DocSubBlock
): Record<string, string> | undefined {
  if (!operationField?.options) return undefined
  if (!block.tools.config?.tool) {
    throw new Error(`${block.type} has operation choices but no tool resolver`)
  }

  const result: Record<string, string> = {}
  for (const option of operationField.options) {
    let toolId: string
    try {
      toolId = block.tools.config.tool({ [operationField.id]: option.id })
    } catch (error) {
      throw new Error(
        `${block.type}.${operationField.id}=${option.id} could not resolve a tool: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (!block.tools.access.includes(toolId)) {
      throw new Error(
        `${block.type}.${operationField.id}=${option.id} resolved inaccessible tool ${toolId}`
      )
    }
    result[option.id] = toolId
  }

  return result
}

function isToolConfig(value: unknown): value is ToolConfig {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.version === 'string' &&
    isRecord(value.params) &&
    isRecord(value.request)
  )
}

async function loadToolConfigs(toolsPath: string): Promise<Map<string, ToolConfig>> {
  const result = new Map<string, ToolConfig>()
  const providerDirs = fs
    .readdirSync(toolsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const provider of providerDirs) {
    const indexPath = path.join(toolsPath, provider, 'index.ts')
    if (!fs.existsSync(indexPath)) continue

    const exports = await import(pathToFileURL(indexPath).href)
    for (const value of Object.values(exports)) {
      if (!isToolConfig(value)) continue
      if (result.has(value.id)) throw new Error(`Duplicate tool config ID: ${value.id}`)
      result.set(value.id, value)
    }
  }

  for (const [id, tool] of Object.entries(registeredTools)) {
    const existing = result.get(id)
    if (existing && existing !== tool) throw new Error(`Conflicting tool registry entry: ${id}`)
    result.set(id, tool)
  }

  return result
}

function toToolInfo(tool: ToolConfig): ToolInfo {
  return {
    description: tool.description,
    params: Object.entries(tool.params)
      .filter(([name, param]) => name !== 'accessToken' && param.visibility !== 'hidden')
      .map(([name, param]) => {
        if (!param.description?.trim()) {
          throw new Error(`Tool ${tool.id} parameter ${name} has no description`)
        }
        return {
          name,
          type: param.type,
          required: param.required === true,
          description: param.description,
        }
      }),
    outputs: tool.outputs ?? {},
  }
}

function toBlockInfo(block: BlockConfig): ToolInfo {
  return {
    description: block.description,
    params: (block.subBlocks ?? []).map((subBlock) => {
      const description =
        block.inputs?.[subBlock.id]?.description || subBlock.description || subBlock.title
      if (!description?.trim()) {
        throw new Error(`Block ${block.type} input ${subBlock.id} has no description`)
      }
      return {
        name: subBlock.id,
        type: block.inputs?.[subBlock.id]?.type ?? subBlock.type,
        required:
          !subBlock.condition &&
          (subBlock.required === true || block.inputs?.[subBlock.id]?.required === true),
        description,
      }
    }),
    outputs: block.outputs ?? {},
  }
}

export function getBlockDocConfigs(): BlockConfig[] {
  return getAllBlocks()
    .filter((block) => block.category === 'blocks')
    .map((block) => sanitizeBlock(block, false))
}

export function getToolDocConfigs(): BlockConfig[] {
  return getAllBlocks()
    .filter(shouldGenerateToolDoc)
    .map((block) => sanitizeBlock(block))
}

export async function loadToolDocSources(rootDir: string): Promise<ToolDocSource[]> {
  const blocks = getToolDocConfigs()
  const tools = await loadToolConfigs(path.join(rootDir, 'apps/tradinggoose/tools'))
  const unresolved: string[] = []
  const sources = blocks.map((config) => {
    const toolInfo = new Map<string, ToolInfo>()
    let usesBlockInfo = false

    for (const toolId of config.tools?.access ?? []) {
      const tool = tools.get(toolId)
      if (tool) toolInfo.set(toolId, toToolInfo(tool))
      else if (AI_DISPATCH_TOOL_IDS.has(toolId)) usesBlockInfo = true
      else unresolved.push(`${config.type}: ${toolId}`)
    }

    return {
      config,
      toolInfo,
      blockInfo: usesBlockInfo || toolInfo.size === 0 ? toBlockInfo(config) : undefined,
    }
  })

  if (unresolved.length > 0) {
    throw new Error(`Unresolved tool configs:\n${unresolved.map((item) => `- ${item}`).join('\n')}`)
  }

  return sources
}

function triggerInstructions(trigger: RuntimeTriggerConfig): string | string[] | undefined {
  if (trigger.instructions?.length) return trigger.instructions
  const value = trigger.subBlocks.find(
    (subBlock) => subBlock.id === 'triggerInstructions'
  )?.defaultValue
  return typeof value === 'string' && value.trim() ? value : undefined
}

function sanitizeTriggerSubBlock(subBlock: SubBlockConfig, triggerId: string): DocSubBlock | null {
  const sanitized = sanitizeSubBlock(subBlock)
  if (!sanitized || sanitized.id === 'selectedTriggerId') return null

  if (
    sanitized.defaultValue === undefined &&
    typeof subBlock.value === 'function' &&
    subBlock.value.length === 0
  ) {
    const defaultValue = resolveMetadataFactory(
      subBlock.value as unknown as () => unknown,
      triggerId,
      subBlock.id,
      'value'
    )
    if (
      typeof defaultValue !== 'string' &&
      typeof defaultValue !== 'number' &&
      typeof defaultValue !== 'boolean'
    ) {
      throw new Error(`${triggerId}.${subBlock.id} value is not serializable`)
    }
    sanitized.defaultValue = defaultValue
  }

  const { condition, ...unconditional } = sanitized
  const conditionDescription = condition
    ? describeVisibilityCondition(condition, 'selectedTriggerId')
    : undefined
  if (!conditionDescription) return unconditional

  const visibility = `Shown when ${conditionDescription}.`
  return {
    ...unconditional,
    description: appendSentence(unconditional.description, visibility),
  }
}

function sanitizeTrigger(trigger: RuntimeTriggerConfig): TriggerConfig {
  const delivery = trigger.webhook ? 'webhook' : trigger.id === 'schedule' ? 'schedule' : 'polling'
  return {
    id: trigger.id,
    name: trigger.name,
    provider: trigger.webhookProvider,
    description: trigger.description,
    subBlocks: trigger.subBlocks
      .map((subBlock) => sanitizeTriggerSubBlock(subBlock, trigger.id))
      .filter((subBlock): subBlock is DocSubBlock => subBlock !== null),
    outputs: trigger.outputs,
    delivery,
    instructions: triggerInstructions(trigger),
  }
}

export function getTriggerDocConfigs(): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY)
    .filter((trigger) => trigger.webhookProvider !== 'core')
    .map(sanitizeTrigger)
}
