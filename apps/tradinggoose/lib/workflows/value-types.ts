import { LISTING_IDENTITY_VALUE_TYPE } from '@/lib/listing/identity'

export const WORKFLOW_VALUE_TYPES = [
  'string',
  'plain',
  'number',
  'boolean',
  'json',
  'object',
  'array',
  'files',
  'file',
  'file[]',
  'any',
  LISTING_IDENTITY_VALUE_TYPE,
] as const

export type WorkflowValueType = (typeof WORKFLOW_VALUE_TYPES)[number]
export type WorkflowParamType = Exclude<
  WorkflowValueType,
  'plain' | 'object' | 'files' | 'file' | 'file[]' | 'any'
>
export type WorkflowProviderParamType = Exclude<
  WorkflowParamType,
  typeof LISTING_IDENTITY_VALUE_TYPE
>
export type WorkflowSchemaType = Exclude<
  WorkflowValueType,
  'plain' | 'files' | 'file' | 'file[]' | 'any'
>
export type WorkflowOutputType = Exclude<WorkflowValueType, 'plain' | 'file' | 'any'>
export type WorkflowVariableType = Exclude<
  WorkflowValueType,
  'string' | 'json' | 'files' | 'file' | 'file[]' | 'any'
>
export type WorkflowFieldType = Exclude<WorkflowOutputType, 'json' | 'file[]'>

export const WORKFLOW_VARIABLE_TYPES = WORKFLOW_VALUE_TYPES.filter(
  (type): type is WorkflowVariableType =>
    type !== 'string' &&
    type !== 'json' &&
    type !== 'files' &&
    type !== 'file' &&
    type !== 'file[]' &&
    type !== 'any'
)

export const WORKFLOW_FIELD_TYPES = WORKFLOW_VALUE_TYPES.filter(
  (type): type is WorkflowFieldType =>
    type !== 'plain' && type !== 'json' && type !== 'file' && type !== 'file[]' && type !== 'any'
)

const WORKFLOW_VALUE_TYPE_SET = new Set<WorkflowValueType>(WORKFLOW_VALUE_TYPES)
const WORKFLOW_VARIABLE_TYPE_SET = new Set<WorkflowVariableType>(WORKFLOW_VARIABLE_TYPES)

const isWorkflowValueType = (type: unknown): type is WorkflowValueType =>
  typeof type === 'string' && WORKFLOW_VALUE_TYPE_SET.has(type as WorkflowValueType)

export const isWorkflowParamType = (type: string): type is WorkflowParamType =>
  isWorkflowValueType(type) &&
  type !== 'plain' &&
  type !== 'object' &&
  type !== 'files' &&
  type !== 'file' &&
  type !== 'file[]' &&
  type !== 'any'

export const isWorkflowVariableType = (type: unknown): type is WorkflowVariableType =>
  isWorkflowValueType(type) && WORKFLOW_VARIABLE_TYPE_SET.has(type as WorkflowVariableType)
