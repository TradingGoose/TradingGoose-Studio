import { PINETS_SURFACE } from '@/lib/indicators/generated/pinets-surface'

const buildCheatSheetMembers = () => ({
  input: PINETS_SURFACE.inputMembers,
  ta: PINETS_SURFACE.taMembers,
  math: PINETS_SURFACE.mathMembers,
  request: PINETS_SURFACE.requestMembers,
  array: PINETS_SURFACE.arrayMembers,
  map: PINETS_SURFACE.mapMembers,
  matrix: PINETS_SURFACE.matrixMembers,
  str: PINETS_SURFACE.strMembers,
  log: PINETS_SURFACE.logMembers,
  indicator: PINETS_SURFACE.indicatorOptions,
  trigger: ['trigger'],
  plotStyles: PINETS_SURFACE.plotStyles,
  hlineStyles: PINETS_SURFACE.hlineStyles,
})

export const CHEAT_SHEET_MEMBERS = buildCheatSheetMembers()

export type CheatSheetMemberKey = keyof typeof CHEAT_SHEET_MEMBERS

const buildCheatSheetTypeDefs = () => {
  const lines: string[] = []
  const push = (value = '') => lines.push(value)
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
  const mathConstants = new Set(['pi', 'e', 'phi', 'rphi'])

  push('type PineSeries<T = number> = T[]')
  push('')

  PINETS_SURFACE.dataSeries.forEach((name) => {
    push(`declare const ${name}: PineSeries<number>`)
  })

  PINETS_SURFACE.seriesNumbers.forEach((name) => {
    push(`declare const ${name}: PineSeries<number>`)
  })

  push('declare const na: any')
  push('declare const nz: (...args: any[]) => any')
  push('declare const color: any')
  push('')

  push('type PlotFunction = (...args: any[]) => void')
  push('type PlotStyleNamespace = {')
  PINETS_SURFACE.plotStyles.forEach((name) => {
    push(`  ${name}: string`)
  })
  push('}')
  push('declare const plot: PlotFunction & PlotStyleNamespace')
  PINETS_SURFACE.plotFunctions
    .filter((name) => name !== 'plot' && (!PINETS_SURFACE.hlineStyles.length || name !== 'hline'))
    .forEach((name) => {
      push(`declare const ${name}: (...args: any[]) => void`)
    })

  if (PINETS_SURFACE.hlineStyles.length > 0) {
    push('type HlineFunction = (...args: any[]) => void')
    push('type HlineStyleNamespace = {')
    PINETS_SURFACE.hlineStyles.forEach((name) => {
      push(`  ${name}: string`)
    })
    push('}')
    push('declare const hline: HlineFunction & HlineStyleNamespace')
  }

  push('')

  const inputReturns: Record<string, string> = {
    int: 'number',
    float: 'number',
    bool: 'boolean',
    color: 'string',
    string: 'string',
    source: 'PineSeries<number>',
    timeframe: 'string',
    time: 'number',
    price: 'number',
    session: 'string',
    symbol: 'string',
    text_area: 'string',
    enum: 'T',
    any: 'any',
    param: 'any',
  }

  push('type InputNamespace = {')
  push('  (...args: any[]): any')
  PINETS_SURFACE.inputMembers.forEach((name) => {
    if (name === 'enum') {
      push('  enum: <T = string>(...args: any[]) => T')
      return
    }
    push(`  ${name}: (...args: any[]) => ${inputReturns[name] ?? 'any'}`)
  })
  push('}')
  push('declare const input: InputNamespace')
  push('')

  const namespaces: Record<string, readonly string[]> = {
    ta: PINETS_SURFACE.taMembers,
    math: PINETS_SURFACE.mathMembers,
    request: PINETS_SURFACE.requestMembers,
    array: PINETS_SURFACE.arrayMembers,
    map: PINETS_SURFACE.mapMembers,
    matrix: PINETS_SURFACE.matrixMembers,
    str: PINETS_SURFACE.strMembers,
    log: PINETS_SURFACE.logMembers,
  }

  Object.entries(namespaces).forEach(([namespace, members]) => {
    push(`type ${capitalize(namespace)}Namespace = {`)
    members.forEach((name) => {
      if (namespace === 'math' && mathConstants.has(name)) {
        push(`  ${name}: number`)
        return
      }
      push(`  ${name}: (...args: any[]) => any`)
    })
    push('}')
    push(`declare const ${namespace}: ${capitalize(namespace)}Namespace`)
    push('')
  })

  push('type IndicatorOptions = {')
  PINETS_SURFACE.indicatorOptions.forEach((name) => {
    push(`  ${name}?: any`)
  })
  push('}')
  push('declare const indicator: (')
  push('  optionsOrTitle?: IndicatorOptions | string,')
  push('  optionsMaybe?: IndicatorOptions')
  push(') => void')
  push("type TriggerMarkerPosition = 'aboveBar' | 'belowBar' | 'inBar'")
  push("type IndicatorTriggerSignal = 'long' | 'short' | 'flat'")
  push('type IndicatorTriggerOptions = {')
  push('  condition: any')
  push('  input: string')
  push('  signal: IndicatorTriggerSignal')
  push('  position?: TriggerMarkerPosition')
  push('  color?: string')
  push('}')
  push('declare const trigger: (event: string, options: IndicatorTriggerOptions) => void')
  push('')

  PINETS_SURFACE.simpleConsts.forEach((name) => {
    push(`declare const ${name}: any`)
  })

  push('')
  return lines.join('\n')
}

export const PINE_CHEAT_SHEET_TYPE_DEFS = buildCheatSheetTypeDefs()

export const PINE_CHEAT_SHEET_EXTRA_LIBS = [
  {
    filePath: 'inmemory://model/pine-globals.d.ts',
    content: PINE_CHEAT_SHEET_TYPE_DEFS,
  },
] as const
