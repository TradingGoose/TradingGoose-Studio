import type { ConverseStreamOutput } from '@aws-sdk/client-bedrock-runtime'
import { createLogger } from '@/lib/logs/console/logger'
import { getModelCapabilities } from '@/providers/ai/models'
import { trackForcedToolUsage } from '@/providers/ai/utils'

const logger = createLogger('BedrockUtils')

export interface BedrockStreamUsage {
  inputTokens: number
  outputTokens: number
}

export function createReadableStreamFromBedrockStream(
  bedrockStream: AsyncIterable<ConverseStreamOutput>,
  onComplete?: (content: string, usage: BedrockStreamUsage) => void
): ReadableStream<Uint8Array> {
  let fullContent = ''
  let inputTokens = 0
  let outputTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of bedrockStream) {
          if (event.contentBlockDelta?.delta?.text) {
            const text = event.contentBlockDelta.delta.text
            fullContent += text
            controller.enqueue(new TextEncoder().encode(text))
          } else if (event.metadata?.usage) {
            inputTokens = event.metadata.usage.inputTokens ?? 0
            outputTokens = event.metadata.usage.outputTokens ?? 0
          }
        }

        if (onComplete) {
          onComplete(fullContent, { inputTokens, outputTokens })
        }

        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

export function checkForForcedToolUsage(
  toolUseBlocks: Array<{ name: string }>,
  toolChoice: any,
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } | null {
  if (typeof toolChoice === 'object' && toolChoice !== null && toolUseBlocks.length > 0) {
    const adaptedToolCalls = toolUseBlocks.map((tool) => ({ name: tool.name }))
    const adaptedToolChoice = toolChoice.tool
      ? { function: { name: toolChoice.tool.name } }
      : toolChoice

    return trackForcedToolUsage(
      adaptedToolCalls,
      adaptedToolChoice,
      logger,
      'bedrock',
      forcedTools,
      usedForcedTools
    )
  }
  return null
}

/** Selects the model's in-region ID or a supported geographic inference profile. */
export function getBedrockModelId(modelId: string, region: string): string {
  if (!modelId.startsWith('bedrock/')) throw new Error(`Invalid Bedrock model ID: ${modelId}`)
  const baseModelId = modelId.slice('bedrock/'.length)
  const inferenceProfiles = getModelCapabilities(modelId)?.bedrockInferenceProfiles
  if (!inferenceProfiles) throw new Error(`Unknown Bedrock model: ${modelId}`)
  if (!inferenceProfiles.length) return baseModelId

  let inferencePrefix: string
  if (region.startsWith('us-gov-')) {
    inferencePrefix = 'us-gov'
  } else if (region.startsWith('us-') || region.startsWith('ca-')) {
    inferencePrefix = 'us'
  } else if (region.startsWith('eu-') || region === 'il-central-1') {
    inferencePrefix = 'eu'
  } else if (region.startsWith('ap-') || region.startsWith('me-')) {
    inferencePrefix = 'apac'
  } else if (region.startsWith('sa-')) {
    inferencePrefix = 'us'
  } else if (region.startsWith('af-')) {
    inferencePrefix = 'eu'
  } else {
    throw new Error(`Unsupported Bedrock region: ${region}`)
  }

  return inferenceProfiles.includes(inferencePrefix)
    ? `${inferencePrefix}.${baseModelId}`
    : baseModelId
}
