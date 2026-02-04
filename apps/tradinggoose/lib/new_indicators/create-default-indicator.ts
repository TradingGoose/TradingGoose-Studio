import type { InputMetaMap } from '@/lib/new_indicators/types'
import { inferInputMetaFromPineCode } from '@/lib/new_indicators/input-meta'

export type DefaultPineIndicatorDefinition = {
  id: string
  name: string
  pineCode: string
  inputMeta?: InputMetaMap
}

export const createDefaultPineIndicator = (definition: DefaultPineIndicatorDefinition) => {
  if (definition.inputMeta) return definition
  const inferredInputMeta = inferInputMetaFromPineCode(definition.pineCode)
  if (!inferredInputMeta) return definition
  return {
    ...definition,
    inputMeta: inferredInputMeta,
  }
}
