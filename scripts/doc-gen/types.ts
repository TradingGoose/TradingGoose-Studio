export interface DocCondition {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
  and?: DocCondition | DocCondition[]
}

/** Serializable subset of SubBlockConfig for doc rendering */
export interface DocSubBlock {
  id: string
  title?: string
  type: string
  layout?: string
  placeholder?: string
  description?: string
  defaultValue?: string | number | boolean
  options?: Array<{ label: string; id: string }>
  required?: boolean
  password?: boolean
  min?: number
  max?: number
  step?: number
  language?: string
  provider?: string
  /** Condition that controls when this field is visible (e.g., which operation is selected) */
  condition?: DocCondition
  /** Condition that controls when this field is required. Resolved before preview rendering. */
  requiredCondition?: DocCondition
}

export interface BlockConfig {
  type: string
  name: string
  description: string
  longDescription?: string
  category: string
  bgColor?: string
  inputs?: Record<string, { type: string; description?: string; required?: boolean }>
  outputs?: Record<string, any>
  tools?: { access?: string[] }
  subBlocks?: DocSubBlock[]
  /** Static sub-block used to select an operation. */
  operationFieldId?: string
  /** Maps operation ID to the runtime tool selected by tools.config.tool. */
  operationToolMap?: Record<string, string>
}

export interface ToolInfo {
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
}

export interface ToolDocSource {
  config: BlockConfig
  toolInfo: Map<string, ToolInfo>
  blockInfo?: ToolInfo
}

export interface TriggerConfig {
  id: string
  name: string
  provider: string
  description: string
  subBlocks: DocSubBlock[]
  outputs: Record<string, any>
  delivery: 'webhook' | 'polling' | 'schedule'
  instructions?: string | string[]
}

export interface RelatedDocPage {
  title: string
  href: string
  description: string
}

export interface GeneratorContext {
  rootDir: string
  docsOutputPath: string
}
