import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const ROOT_DIR = resolve(SCRIPT_DIR, '..', '..')
const PINETS_TYPES_DIR = join(ROOT_DIR, 'node_modules', 'pinets', 'dist', 'types')
const PINETS_NAMESPACES_DIR = join(PINETS_TYPES_DIR, 'namespaces')
const PINETS_TYPES_FILE = join(PINETS_TYPES_DIR, 'types', 'PineTypes.d.ts')
const PINETS_CONTEXT_FILE = join(PINETS_TYPES_DIR, 'Context.class.d.ts')
const PINETS_PACKAGE_FILE = join(ROOT_DIR, 'node_modules', 'pinets', 'package.json')

export const OUTPUT_PATHS = {
  pinetsSurface: join(
    ROOT_DIR,
    'apps',
    'tradinggoose',
    'lib',
    'indicators',
    'generated',
    'pinets-surface.ts'
  ),
  copilotIndicatorReference: join(
    ROOT_DIR,
    'apps',
    'tradinggoose',
    'lib',
    'indicators',
    'generated',
    'copilot-indicator-reference.ts'
  ),
} as const

export type PinetsSurface = {
  pinetsVersion: string
  dataSeries: string[]
  seriesNumbers: string[]
  simpleConsts: string[]
  plotFunctions: string[]
  plotStyles: string[]
  hlineStyles: string[]
  inputMembers: string[]
  taMembers: string[]
  mathMembers: string[]
  requestMembers: string[]
  arrayMembers: string[]
  mapMembers: string[]
  matrixMembers: string[]
  strMembers: string[]
  logMembers: string[]
  indicatorOptions: string[]
  contextFields: string[]
  contextDeprecatedGetters: string[]
}

const DATA_SERIES = [
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
] as const

const SERIES_NUMBERS = ['bar_index', 'last_bar_index', 'last_bar_time'] as const

const SIMPLE_CONSTS = [
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
] as const

const PLOT_FUNCTIONS = [
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
] as const

const INDICATOR_OPTION_EXCLUSIONS = new Set(['title', 'shorttitle'])

const readText = (filePath: string) => readFileSync(filePath, 'utf8')

const readJson = <T>(filePath: string): T => JSON.parse(readText(filePath)) as T

const parseMethodsFromIndex = (filePath: string) => {
  const text = readText(filePath)
  const match = text.match(/declare const methods:\s*{([\s\S]*?)};/)
  if (!match) {
    throw new Error(`No methods block found in ${filePath}`)
  }

  const methods = new Set<string>()
  match[1]?.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:/)
    if (!nameMatch?.[1]) return
    methods.add(nameMatch[1])
  })

  return Array.from(methods).sort()
}

const listDtsMethodsFromDir = (dirPath: string) => {
  if (!existsSync(dirPath)) {
    throw new Error(`Methods directory not found: ${dirPath}`)
  }

  return Array.from(new Bun.Glob('*.d.ts').scanSync({ cwd: dirPath }))
    .map((file) => file.replace(/\.d\.ts$/, ''))
    .sort()
}

const parseClassBody = (filePath: string, className: string) => {
  const text = readText(filePath)
  const classMatch = text.match(
    new RegExp(`export declare class ${className} \\{([\\s\\S]*?)\\n\\}`, 'm')
  )
  if (!classMatch?.[1]) {
    throw new Error(`Class ${className} not found in ${filePath}`)
  }
  return classMatch[1]
}

const parseClassMethods = (filePath: string, className: string) => {
  const body = parseClassBody(filePath, className)
  const methods = new Set<string>()

  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('constructor')) return
    if (trimmed.startsWith('private')) return
    if (trimmed.startsWith('protected')) return
    if (trimmed.startsWith('get ') || trimmed.startsWith('set ')) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*\(/)
    if (!nameMatch?.[1]) return
    methods.add(nameMatch[1])
  })

  return Array.from(methods).sort()
}

const parseClassGetters = (filePath: string, className: string) => {
  const body = parseClassBody(filePath, className)
  const getters = new Set<string>()

  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    const nameMatch = trimmed.match(/^get\s+([A-Za-z0-9_]+)\s*\(\)\s*:/)
    if (!nameMatch?.[1]) return
    getters.add(nameMatch[1])
  })

  return Array.from(getters).sort()
}

const parseClassFields = (filePath: string, className: string) => {
  const body = parseClassBody(filePath, className)
  const fields = new Set<string>()

  body.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('private')) return
    if (trimmed.startsWith('protected')) return
    if (trimmed.startsWith('static')) return
    if (trimmed.startsWith('constructor')) return
    if (trimmed.startsWith('get ') || trimmed.startsWith('set ')) return
    if (trimmed.includes('(')) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*:/)
    if (!nameMatch?.[1]) return
    fields.add(nameMatch[1])
  })

  return Array.from(fields).sort()
}

const parseTypeProperties = (filePath: string, typeName: string) => {
  const text = readText(filePath)
  const typeMatch = text.match(new RegExp(`type\\s+${typeName}\\s*=\\s*\\{([\\s\\S]*?)\\};`, 'm'))
  if (!typeMatch?.[1]) {
    throw new Error(`Type ${typeName} not found in ${filePath}`)
  }

  const props = new Set<string>()
  typeMatch[1].split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const nameMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*\??\s*:/)
    if (!nameMatch?.[1]) return
    props.add(nameMatch[1])
  })

  return Array.from(props).sort()
}

export const buildPinetsSurface = (): PinetsSurface => {
  const pinetsPackage = readJson<{ version: string }>(PINETS_PACKAGE_FILE)

  return {
    pinetsVersion: pinetsPackage.version,
    dataSeries: [...DATA_SERIES],
    seriesNumbers: [...SERIES_NUMBERS],
    simpleConsts: [...SIMPLE_CONSTS],
    plotFunctions: [...PLOT_FUNCTIONS],
    plotStyles: parseClassGetters(join(PINETS_NAMESPACES_DIR, 'Plots.d.ts'), 'PlotHelper'),
    hlineStyles: parseClassGetters(join(PINETS_NAMESPACES_DIR, 'Plots.d.ts'), 'HlineHelper'),
    inputMembers: parseMethodsFromIndex(join(PINETS_NAMESPACES_DIR, 'input', 'input.index.d.ts')),
    taMembers: parseMethodsFromIndex(join(PINETS_NAMESPACES_DIR, 'ta', 'ta.index.d.ts')),
    mathMembers: parseMethodsFromIndex(join(PINETS_NAMESPACES_DIR, 'math', 'math.index.d.ts')),
    requestMembers: parseMethodsFromIndex(
      join(PINETS_NAMESPACES_DIR, 'request', 'request.index.d.ts')
    ),
    arrayMembers: listDtsMethodsFromDir(join(PINETS_NAMESPACES_DIR, 'array', 'methods')),
    mapMembers: listDtsMethodsFromDir(join(PINETS_NAMESPACES_DIR, 'map', 'methods')),
    matrixMembers: listDtsMethodsFromDir(join(PINETS_NAMESPACES_DIR, 'matrix', 'methods')),
    strMembers: parseClassMethods(join(PINETS_NAMESPACES_DIR, 'Str.d.ts'), 'Str'),
    logMembers: parseClassMethods(join(PINETS_NAMESPACES_DIR, 'Log.d.ts'), 'Log'),
    indicatorOptions: parseTypeProperties(PINETS_TYPES_FILE, 'IndicatorOptions').filter(
      (option) => !INDICATOR_OPTION_EXCLUSIONS.has(option)
    ),
    contextFields: parseClassFields(PINETS_CONTEXT_FILE, 'Context'),
    contextDeprecatedGetters: parseClassGetters(PINETS_CONTEXT_FILE, 'Context'),
  }
}

export const renderModule = (params: { generatedBy: string; statements: string[] }) => {
  return [
    `// This file is auto-generated by ${params.generatedBy}.`,
    '// Do not edit manually.',
    '',
    ...params.statements,
    '',
  ].join('\n')
}

export const renderConstExport = (name: string, value: unknown) =>
  `export const ${name} = ${JSON.stringify(value, null, 2)} as const`

export const writeGeneratedFile = (filePath: string, content: string) => {
  mkdirSync(dirname(filePath), { recursive: true })
  const previous = existsSync(filePath) ? readText(filePath) : null
  if (previous === content) {
    return false
  }
  writeFileSync(filePath, content, 'utf8')
  return true
}
