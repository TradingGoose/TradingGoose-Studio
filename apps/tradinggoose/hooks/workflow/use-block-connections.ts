import { BlockPathCalculator } from '@/lib/block-path-calculator'
import {
  extractFieldsFromSchema,
  parseResponseFormatSafely,
  type Field,
} from '@/lib/response-format'
import { readBlockOutputs } from '@/lib/workflows/block-outputs'
import { useWorkflowBlocks, useWorkflowEdges } from '@/lib/yjs/use-workflow-doc'

export interface ConnectedBlock {
  id: string
  type: string
  outputType: string | string[]
  name: string
  responseFormat?: {
    fields?: Field[]
    name?: string
    schema?: {
      type: string
      properties: Record<string, any>
      required?: string[]
    }
  }
}

export function useBlockConnections(blockId: string) {
  const blocks = useWorkflowBlocks()
  const edges = useWorkflowEdges()

  const allPathNodeIds = BlockPathCalculator.findAllPathNodes(edges, blockId)

  const toConnectedBlock = (sourceId: string): ConnectedBlock | null => {
    const sourceBlock = blocks[sourceId]
    if (!sourceBlock) return null

    const mergedSubBlocks = blocks[sourceId]?.subBlocks || {}
    const responseFormat = parseResponseFormatSafely(
      blocks[sourceId]?.subBlocks?.responseFormat?.value,
      sourceId
    )
    const blockOutputs = readBlockOutputs(
      sourceBlock.type,
      mergedSubBlocks,
      sourceBlock.triggerMode
    )
    const outputFields = responseFormat
      ? extractFieldsFromSchema(responseFormat)
      : Object.entries(blockOutputs).map(([name, value]: [string, any]) => ({
          name,
          type: value && typeof value === 'object' && 'type' in value ? value.type : 'string',
          description:
            value && typeof value === 'object' && 'description' in value
              ? value.description
              : undefined,
        }))

    return {
      id: sourceBlock.id,
      type: sourceBlock.type,
      outputType: outputFields.map((field: Field) => field.name),
      name: sourceBlock.name,
      responseFormat,
    }
  }

  const allPathConnections = allPathNodeIds
    .map(toConnectedBlock)
    .filter(Boolean) as ConnectedBlock[]
  const directIncomingConnections = edges
    .filter((edge) => edge.target === blockId)
    .map((edge) => edge.source)
    .map(toConnectedBlock)
    .filter(Boolean) as ConnectedBlock[]

  return {
    incomingConnections: allPathConnections,
    directIncomingConnections,
    hasIncomingConnections: allPathConnections.length > 0,
  }
}
