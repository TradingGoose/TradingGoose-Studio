import { createLogger } from '@/lib/logs/console/logger'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('DeploymentUtils')

/**
 * Build a curl -d example payload based on the API trigger input format.
 */
export function getInputFormatExample(
  includeStreaming = false,
  selectedStreamingOutputs: string[] = []
): string {
  let inputFormatExample = ''
  try {
    const blocks = Object.values(useWorkflowStore.getState().blocks)

    const apiTriggerBlock = blocks.find((block) => block.type === 'api_trigger')
    const targetBlock = apiTriggerBlock

    if (targetBlock) {
      const inputFormat = useSubBlockStore.getState().getValue(targetBlock.id, 'inputFormat')

      const exampleData: Record<string, any> = {}

      if (inputFormat && Array.isArray(inputFormat) && inputFormat.length > 0) {
        inputFormat.forEach((field: any) => {
          if (field.name) {
            switch (field.type) {
              case 'string':
                exampleData[field.name] = 'example'
                break
              case 'number':
                exampleData[field.name] = 42
                break
              case 'boolean':
                exampleData[field.name] = true
                break
              case 'object':
                exampleData[field.name] = { key: 'value' }
                break
              case 'array':
                exampleData[field.name] = [1, 2, 3]
                break
              case 'files':
                exampleData[field.name] = [
                  {
                    data: 'data:application/pdf;base64,...',
                    type: 'file',
                    name: 'document.pdf',
                    mime: 'application/pdf',
                  },
                ]
                break
            }
          }
        })
      }

      if (includeStreaming && selectedStreamingOutputs.length > 0) {
        exampleData.stream = true
        const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

        const convertedOutputs = selectedStreamingOutputs.map((outputId) => {
          if (UUID_REGEX.test(outputId)) {
            const underscoreIndex = outputId.indexOf('_')
            if (underscoreIndex === -1) return outputId

            const blockId = outputId.substring(0, underscoreIndex)
            const attribute = outputId.substring(underscoreIndex + 1)

            const block = blocks.find((b) => b.id === blockId)
            if (block?.name) {
              const normalizedBlockName = block.name.toLowerCase().replace(/\s+/g, '')
              return `${normalizedBlockName}.${attribute}`
            }
          }

          return outputId
        })

        exampleData.selectedOutputs = convertedOutputs
      }

      if (Object.keys(exampleData).length > 0) {
        inputFormatExample = ` -d '${JSON.stringify(exampleData)}'`
      }
    }
  } catch (error) {
    logger.error('Error generating input format example:', error)
  }

  return inputFormatExample
}
