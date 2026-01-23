import type { CustomIndicatorDefinition } from '@/stores/custom-indicators/types'
import type { CodeSection } from '@/widgets/widgets/editor_indicator/editor-indicator-types'

export const getCodeSectionValue = (
  section: CodeSection,
  indicator: CustomIndicatorDefinition | null
): string => {
  if (!indicator) return ''
  switch (section) {
    case 'calc':
      return indicator.calcCode ?? ''
    default:
      return ''
  }
}
