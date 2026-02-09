const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const NAMESPACES_DIR = path.join(ROOT, 'node_modules', 'pinets', 'dist', 'types', 'namespaces')
const PINE_TYPES_FILE = path.join(
  ROOT,
  'node_modules',
  'pinets',
  'dist',
  'types',
  'types',
  'PineTypes.d.ts'
)
const OUTPUT_FILE = path.join(
  ROOT,
  'apps',
  'tradinggoose',
  'widgets',
  'widgets',
  'editor_indicator',
  'components',
  'pine-cheat-sheet-members.ts'
)
const OUTPUT_TYPES_FILE = path.join(
  ROOT,
  'apps',
  'tradinggoose',
  'widgets',
  'widgets',
  'editor_indicator',
  'components',
  'pine-cheat-sheet-typings.ts'
)

const readText = (filePath) => fs.readFileSync(filePath, 'utf8')

const parseMethodsFromIndex = (filePath) => {
  const text = readText(filePath)
  const match = text.match(/declare const methods:\s*{([\s\S]*?)};/)
  if (!match) {
    throw new Error(`No methods block found in ${filePath}`)
  }
  const block = match[1]
  const methods = new Set()
  block.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:/)
    if (!nameMatch) return
    methods.add(nameMatch[1])
  })
  return Array.from(methods).sort()
}

const listMethodsFromDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Methods directory not found: ${dirPath}`)
  }
  return fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.d.ts'))
    .map((file) => file.replace(/\.d\.ts$/, ''))
    .sort()
}

const parseClassMethods = (filePath, className) => {
  const text = readText(filePath)
  const classMatch = text.match(
    new RegExp(`export declare class ${className} \\{([\\s\\S]*?)\\n\\}`, 'm')
  )
  if (!classMatch) {
    throw new Error(`Class ${className} not found in ${filePath}`)
  }
  const body = classMatch[1]
  const methods = new Set()
  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('constructor')) return
    if (trimmed.startsWith('private')) return
    if (trimmed.startsWith('protected')) return
    if (trimmed.startsWith('get ') || trimmed.startsWith('set ')) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*\(/)
    if (!nameMatch) return
    methods.add(nameMatch[1])
  })
  return Array.from(methods).sort()
}

const parseClassGetters = (filePath, className) => {
  const text = readText(filePath)
  const classMatch = text.match(
    new RegExp(`export declare class ${className} \\{([\\s\\S]*?)\\n\\}`, 'm')
  )
  if (!classMatch) {
    throw new Error(`Class ${className} not found in ${filePath}`)
  }
  const body = classMatch[1]
  const getters = new Set()
  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('get ')) return
    const nameMatch = trimmed.match(/^get\s+([A-Za-z0-9_]+)\s*\(\)\s*:/)
    if (!nameMatch) return
    getters.add(nameMatch[1])
  })
  return Array.from(getters).sort()
}

const parseTypeProperties = (filePath, typeName) => {
  const text = readText(filePath)
  const typeMatch = text.match(
    new RegExp(`type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\};`, 'm')
  )
  if (!typeMatch) {
    throw new Error(`Type ${typeName} not found in ${filePath}`)
  }
  const body = typeMatch[1]
  const props = new Set()
  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*\??\s*:/)
    if (!nameMatch) return
    props.add(nameMatch[1])
  })
  return Array.from(props).sort()
}

const generateMembers = () => {
  const inputIndex = path.join(NAMESPACES_DIR, 'input', 'input.index.d.ts')
  const taIndex = path.join(NAMESPACES_DIR, 'ta', 'ta.index.d.ts')
  const mathIndex = path.join(NAMESPACES_DIR, 'math', 'math.index.d.ts')
  const requestIndex = path.join(NAMESPACES_DIR, 'request', 'request.index.d.ts')
  const arrayMethodsDir = path.join(NAMESPACES_DIR, 'array', 'methods')
  const mapMethodsDir = path.join(NAMESPACES_DIR, 'map', 'methods')
  const matrixMethodsDir = path.join(NAMESPACES_DIR, 'matrix', 'methods')
  const strFile = path.join(NAMESPACES_DIR, 'Str.d.ts')
  const logFile = path.join(NAMESPACES_DIR, 'Log.d.ts')
  const plotsFile = path.join(NAMESPACES_DIR, 'Plots.d.ts')
  const indicatorOptionExclusions = new Set(['title', 'shorttitle'])

  return {
    input: parseMethodsFromIndex(inputIndex),
    ta: parseMethodsFromIndex(taIndex),
    math: parseMethodsFromIndex(mathIndex),
    request: parseMethodsFromIndex(requestIndex),
    array: listMethodsFromDir(arrayMethodsDir),
    map: listMethodsFromDir(mapMethodsDir),
    matrix: listMethodsFromDir(matrixMethodsDir),
    str: parseClassMethods(strFile, 'Str'),
    log: parseClassMethods(logFile, 'Log'),
    indicator: parseTypeProperties(PINE_TYPES_FILE, 'IndicatorOptions').filter(
      (option) => !indicatorOptionExclusions.has(option)
    ),
    plotStyles: parseClassGetters(plotsFile, 'PlotHelper'),
    hlineStyles: parseClassGetters(plotsFile, 'HlineHelper'),
  }
}

const writeOutput = (members) => {
  const content = `// This file is auto-generated by scripts/generate-pine-cheat-sheet.cjs.
// Do not edit manually.

export const CHEAT_SHEET_MEMBERS = ${JSON.stringify(members, null, 2)} as const

export type CheatSheetMemberKey = keyof typeof CHEAT_SHEET_MEMBERS
`
  fs.writeFileSync(OUTPUT_FILE, content, 'utf8')
}

const buildTypeDefs = (members) => {
  const lines = []
  const push = (value = '') => lines.push(value)
  const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1)

  const dataSeries = [
    'open',
    'high',
    'low',
    'close',
    'volume',
    'hl2',
    'hlc3',
    'ohlc4',
    'openTime',
    'closeTime',
  ]
  const seriesNumbers = ['bar_index', 'last_bar_index', 'last_bar_time']
  const simpleConsts = [
    'barstate',
    'syminfo',
    'timeframe',
    'order',
    'currency',
    'display',
    'shape',
    'location',
    'size',
    'format',
    'dayofweek',
  ]
  const plotFunctions = [
    'plot',
    'plotshape',
    'plotchar',
    'plotarrow',
    'plotbar',
    'plotcandle',
    'hline',
    'fill',
    'bgcolor',
    'barcolor',
  ]
  const plotStyleKeys = members.plotStyles ?? []
  const hlineStyleKeys = members.hlineStyles ?? []
  const mathConstants = new Set(['pi', 'e', 'phi', 'rphi'])

  push('type PineSeries<T = number> = T[]')
  push('')

  dataSeries.forEach((name) => {
    push(`declare const ${name}: PineSeries<number>`)
  })

  seriesNumbers.forEach((name) => {
    push(`declare const ${name}: PineSeries<number>`)
  })

  push('declare const na: any')
  push('declare const nz: (...args: any[]) => any')
  push('declare const color: any')
  push('')

  const plotStyleTypeName = 'PlotStyleNamespace'
  const plotFunctionTypeName = 'PlotFunction'
  const hasHlineStyles = hlineStyleKeys.length > 0
  push(`type ${plotFunctionTypeName} = (...args: any[]) => void`)
  push(`type ${plotStyleTypeName} = {`)
  plotStyleKeys.forEach((name) => {
    push(`  ${name}: string`)
  })
  push('}')
  push(`declare const plot: ${plotFunctionTypeName} & ${plotStyleTypeName}`)
  plotFunctions
    .filter((name) => name !== 'plot' && (!hasHlineStyles || name !== 'hline'))
    .forEach((name) => {
      push(`declare const ${name}: (...args: any[]) => void`)
    })
  if (hlineStyleKeys.length > 0) {
    const hlineFunctionTypeName = 'HlineFunction'
    const hlineStyleTypeName = 'HlineStyleNamespace'
    push(`type ${hlineFunctionTypeName} = (...args: any[]) => void`)
    push(`type ${hlineStyleTypeName} = {`)
    hlineStyleKeys.forEach((name) => {
      push(`  ${name}: string`)
    })
    push('}')
    push(`declare const hline: ${hlineFunctionTypeName} & ${hlineStyleTypeName}`)
  }

  push('')

  const inputReturns = {
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
  const inputMembers = members.input ?? []
  push('type InputNamespace = {')
  push('  (...args: any[]): any')
  inputMembers.forEach((name) => {
    if (name === 'enum') {
      push('  enum: <T = string>(...args: any[]) => T')
      return
    }
    const returnType = inputReturns[name] ?? 'any'
    push(`  ${name}: (...args: any[]) => ${returnType}`)
  })
  push('}')
  push('declare const input: InputNamespace')
  push('')

  const namespaceReturns = {
    ta: 'any',
    math: 'any',
    request: 'any',
    array: 'any',
    map: 'any',
    matrix: 'any',
    str: 'any',
    log: 'any',
  }

  Object.entries(namespaceReturns).forEach(([namespace, returnType]) => {
    const typeName = `${capitalize(namespace)}Namespace`
    const namespaceMembers = members[namespace] ?? []
    push(`type ${typeName} = {`)
    namespaceMembers.forEach((name) => {
      if (namespace === 'math' && mathConstants.has(name)) {
        push(`  ${name}: number`)
        return
      }
      push(`  ${name}: (...args: any[]) => ${returnType}`)
    })
    push('}')
    push(`declare const ${namespace}: ${typeName}`)
    push('')
  })

  const indicatorOptions = members.indicator ?? []
  push('type IndicatorOptions = {')
  indicatorOptions.forEach((name) => {
    push(`  ${name}?: any`)
  })
  push('}')
  push('declare const indicator: (')
  push('  optionsOrTitle?: IndicatorOptions | string,')
  push('  optionsMaybe?: IndicatorOptions')
  push(') => void')
  push('')

  simpleConsts.forEach((name) => {
    push(`declare const ${name}: any`)
  })

  push('')

  return lines.join('\n')
}

const writeTypesOutput = (members) => {
  const typeDefs = buildTypeDefs(members)
  const content = `// This file is auto-generated by scripts/generate-pine-cheat-sheet.cjs.
// Do not edit manually.

export const PINE_CHEAT_SHEET_TYPE_DEFS = ${JSON.stringify(typeDefs)}

export const PINE_CHEAT_SHEET_EXTRA_LIBS = [
  {
    filePath: 'inmemory://model/pine-globals.d.ts',
    content: PINE_CHEAT_SHEET_TYPE_DEFS,
  },
] as const
`
  fs.writeFileSync(OUTPUT_TYPES_FILE, content, 'utf8')
}

const main = () => {
  if (!fs.existsSync(NAMESPACES_DIR)) {
    throw new Error(`PineTS namespaces directory not found: ${NAMESPACES_DIR}`)
  }
  const members = generateMembers()
  writeOutput(members)
  writeTypesOutput(members)
  console.log(`Wrote ${OUTPUT_FILE}`)
  console.log(`Wrote ${OUTPUT_TYPES_FILE}`)
}

main()
