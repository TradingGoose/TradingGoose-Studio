import { processExecutionFiles } from '@/lib/execution/files'

type WorkflowInputFileContext = {
  executionContext: { workspaceId: string; workflowId: string; executionId: string }
  requestId: string
}

type WorkflowInput = Record<string, unknown>

type WorkflowInputFormatBlock = {
  type: string
  subBlocks?: { inputFormat?: { value?: unknown } }
}

export async function processWorkflowInputFormatFiles(
  params: {
    input: WorkflowInput
    blocks: Record<string, WorkflowInputFormatBlock>
    blockId?: string
    blockType?: string
  } & WorkflowInputFileContext
) {
  const block = params.blockId
    ? params.blocks[params.blockId]
    : Object.values(params.blocks).find((candidate) => candidate.type === params.blockType)
  const inputFormat = block?.subBlocks?.inputFormat?.value

  if (!Array.isArray(inputFormat)) {
    return params.input
  }

  const initialInput = params.input
  let processedInput = initialInput

  for (const field of inputFormat as Array<{ name?: unknown; type?: unknown }>) {
    if (field.type !== 'files' || typeof field.name !== 'string') {
      continue
    }

    const fieldValue = processedInput[field.name]
    if (!fieldValue || typeof fieldValue !== 'object') {
      continue
    }

    if (processedInput === initialInput) {
      processedInput = { ...initialInput }
    }

    processedInput[field.name] = await processExecutionFiles(
      fieldValue,
      params.executionContext,
      params.requestId
    )
  }

  return processedInput
}
