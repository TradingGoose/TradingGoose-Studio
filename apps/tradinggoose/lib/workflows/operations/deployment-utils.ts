import { createLogger } from '@/lib/logs/console/logger'
import { getSnapshotForWorkflow } from '@/lib/yjs/workflow-session-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('DeploymentUtils')

/**
 * Build a curl -d example payload based on the API trigger input format.
 */
export function getInputFormatExample(workflowId?: string): string {
  let inputFormatExample = ''
  try {
    const targetWorkflowId = workflowId || useWorkflowRegistry.getState().getActiveWorkflowId()
    const snapshot = targetWorkflowId ? getSnapshotForWorkflow(targetWorkflowId) : null
    const blocks = Object.values(snapshot?.blocks ?? {})

    const apiTriggerBlock = blocks.find((block: any) => block.type === 'api_trigger')
    const targetBlock = apiTriggerBlock as any

    if (targetBlock) {
      const inputFormat = targetBlock?.subBlocks?.inputFormat?.value

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

      if (Object.keys(exampleData).length > 0) {
        inputFormatExample = ` -d '${JSON.stringify(exampleData)}'`
      }
    }
  } catch (error) {
    logger.error('Error generating input format example:', error)
  }

  return inputFormatExample
}
