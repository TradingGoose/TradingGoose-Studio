import type { InputMetaMap } from '@/lib/indicators/types'
import { inferInputMetaFromPineCode } from '@/lib/indicators/input-meta'

export type DefaultIndicatorDefinition = {
  id: string
  name: string
  pineCode: string
  inputMeta?: InputMetaMap
}

export const createDefaultIndicator = (definition: DefaultIndicatorDefinition) => {
  if (definition.inputMeta) return definition
  const inferredInputMeta = inferInputMetaFromPineCode(definition.pineCode)
  if (!inferredInputMeta) return definition
  return {
    ...definition,
    inputMeta: inferredInputMeta,
  }
}
