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
  condition?: { field: string; value: string | string[] }
}

export interface BlockConfig {
  type: string
  name: string
  description: string
  longDescription?: string
  category: string
  bgColor?: string
  outputs?: Record<string, any>
  tools?: { access?: string[] }
  subBlocks?: DocSubBlock[]
  /** Maps operation ID → tool name (extracted from tools.config.tool switch) */
  operationToolMap?: Record<string, string>
}

export interface ToolInfo {
  description: string
  params: Array<{ name: string; type: string; required: boolean; description: string }>
  outputs: Record<string, any>
}

export interface RelatedDocPage {
  title: string
  href: string
  description: string
}

export interface GeneratorContext {
  rootDir: string
  blocksPath: string
  toolsPath: string
  docsOutputPath: string
}
