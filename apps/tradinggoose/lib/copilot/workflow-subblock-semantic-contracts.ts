import type { BlockConfig, SubBlockConfig } from '@/blocks/types'

export interface RuntimeToolManifestSemanticValidator {
  path: string
  kind: string
  args?: Record<string, unknown>
  description?: string
  message?: string
}

export type EmbeddedDocumentValueSelector =
  | {
      kind: 'json_array_field'
      field: string
      ignoreEmpty?: boolean
    }
  | {
      kind: 'raw'
    }

export type EmbeddedDocumentValidator = {
  whenBlockType: string
  path: string
  selector?: EmbeddedDocumentValueSelector
  validators: RuntimeToolManifestSemanticValidator[]
}

const JSON_SCHEMA_ROOT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true,
  anyOf: [
    { required: ['type'] },
    { required: ['properties'] },
    { required: ['items'] },
    { required: ['oneOf'] },
    { required: ['anyOf'] },
    { required: ['allOf'] },
    { required: ['$ref'] },
  ],
  properties: {
    type: { type: 'string' },
    properties: { type: 'object' },
    items: {},
    required: { type: 'array' },
    additionalProperties: {},
    oneOf: { type: 'array' },
    anyOf: { type: 'array' },
    allOf: { type: 'array' },
    $ref: { type: 'string' },
  },
}

const STRUCTURED_RESPONSE_FORMAT_SCHEMA: Record<string, unknown> = {
  anyOf: [
    JSON_SCHEMA_ROOT_SCHEMA,
    {
      type: 'object',
      required: ['schema'],
      additionalProperties: true,
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        strict: { type: 'boolean' },
        schema: JSON_SCHEMA_ROOT_SCHEMA,
      },
    },
  ],
}

const CONDITION_ENTRIES_SCHEMA: Record<string, unknown> = {
  type: 'array',
  items: {
    type: 'object',
    required: ['title', 'value'],
    additionalProperties: true,
    properties: {
      title: { type: 'string' },
      value: { type: 'string' },
    },
  },
}

function buildCodeFenceValidator(
  message: string
): RuntimeToolManifestSemanticValidator {
  return {
    path: '',
    kind: 'string_forbids_substring',
    args: { substring: '```' },
    description: 'Do not wrap code or JSON in markdown fences.',
    message,
  }
}

function buildJsonTextValidators(args: {
  schema: Record<string, unknown>
  message: string
  codeFenceMessage: string
}): RuntimeToolManifestSemanticValidator[] {
  return [
    buildCodeFenceValidator(args.codeFenceMessage),
    {
      path: '',
      kind: 'string_json_schema',
      args: { schema: args.schema },
      description: 'Use valid JSON text that matches the expected structure.',
      message: args.message,
    },
  ]
}

function buildCodeSyntaxValidators(args: {
  mode: 'program' | 'function_body' | 'expression'
  message: string
  codeFenceMessage: string
}): RuntimeToolManifestSemanticValidator[] {
  return [
    buildCodeFenceValidator(args.codeFenceMessage),
    {
      path: '',
      kind: 'string_code_syntax',
      args: { language: 'typescript', mode: args.mode },
      description: 'Use valid TypeScript syntax.',
      message: args.message,
    },
  ]
}

function buildSubBlockValidators(
  blockType: string,
  subBlock: SubBlockConfig
): EmbeddedDocumentValidator[] {
  const path = `subBlocks.${subBlock.id}.value`

  if (subBlock.type === 'condition-input') {
    return [
      {
        whenBlockType: blockType,
        path,
        validators: buildJsonTextValidators({
          schema: CONDITION_ENTRIES_SCHEMA,
          message:
            'Condition sub-blocks must store canonical JSON condition entries with `title` and `value` fields.',
          codeFenceMessage:
            'Condition entries must be raw JSON text, not wrapped in markdown fences.',
        }),
      },
      {
        whenBlockType: blockType,
        path,
        selector: {
          kind: 'json_array_field',
          field: 'value',
          ignoreEmpty: true,
        },
        validators: buildCodeSyntaxValidators({
          mode: 'expression',
          message:
            'Each non-empty condition branch value must be a valid TypeScript/JavaScript expression.',
          codeFenceMessage:
            'Condition expressions must not be wrapped in markdown fences.',
        }),
      },
    ]
  }

  if (subBlock.type !== 'code') {
    return []
  }

  if (subBlock.language === 'typescript') {
    return [
      {
        whenBlockType: blockType,
        path,
        validators: buildCodeSyntaxValidators({
          mode: subBlock.generationType === 'typescript-function-body' ? 'function_body' : 'program',
          message:
            subBlock.generationType === 'typescript-function-body'
              ? 'Expected valid raw TypeScript function-body code.'
              : 'Expected valid raw TypeScript source.',
          codeFenceMessage: 'Code sub-blocks must not be wrapped in markdown fences.',
        }),
      },
    ]
  }

  if (subBlock.language !== 'json') {
    return []
  }

  const schema =
    blockType === 'agent' && subBlock.id === 'responseFormat'
      ? STRUCTURED_RESPONSE_FORMAT_SCHEMA
      : JSON_SCHEMA_ROOT_SCHEMA

  return [
    {
      whenBlockType: blockType,
      path,
      validators: buildJsonTextValidators({
        schema,
        message:
          blockType === 'agent' && subBlock.id === 'responseFormat'
            ? 'Agent responseFormat must be valid JSON Schema text or a structured-response wrapper with a `schema` field.'
            : 'Expected valid JSON Schema text.',
        codeFenceMessage: 'JSON schema sub-blocks must not be wrapped in markdown fences.',
      }),
    },
  ]
}

type RegisteredBlockEntry = {
  blockType: string
  blockConfig: BlockConfig
}

async function getRegisteredBlocks(): Promise<RegisteredBlockEntry[]> {
  const { registry: blockRegistry } = await import('@/blocks/registry')

  return Object.entries(blockRegistry).flatMap(([registryKey, blockConfig]) => {
    if (!blockConfig) {
      return []
    }

    const blockType =
      typeof blockConfig.type === 'string' && blockConfig.type.trim().length > 0
        ? blockConfig.type
        : registryKey

    return [{ blockType, blockConfig: blockConfig as BlockConfig }]
  })
}

export async function buildWorkflowEmbeddedDocumentValidators(): Promise<EmbeddedDocumentValidator[]> {
  const registeredBlocks = await getRegisteredBlocks()
  return registeredBlocks.flatMap(({ blockType, blockConfig }) =>
    blockConfig.subBlocks.flatMap((subBlock) =>
      buildSubBlockValidators(blockType, subBlock)
    )
  )
}
