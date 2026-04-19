import {
  getEntityDocumentSchema,
  INDICATOR_DOCUMENT_FORMAT,
} from '../../apps/tradinggoose/lib/copilot/entity-documents'
import { DEFAULT_INDICATOR_RUNTIME_ENTRIES } from '../../apps/tradinggoose/lib/indicators/default/runtime'
import {
  INDICATOR_DEFAULTS,
  INDICATOR_OPTION_KEYS,
} from '../../apps/tradinggoose/lib/indicators/indicator-options'
import { INPUT_TYPES } from '../../apps/tradinggoose/lib/indicators/input-meta'
import {
  INDICATOR_TRIGGER_EVENT_PATTERN,
  INDICATOR_TRIGGER_VALID_POSITIONS,
  INDICATOR_TRIGGER_VALID_SIGNALS,
} from '../../apps/tradinggoose/lib/indicators/trigger-bridge'
import { UNSUPPORTED_INDICATOR_FEATURES } from '../../apps/tradinggoose/lib/indicators/unsupported'
import {
  buildPinetsSurface,
  OUTPUT_PATHS,
  renderConstExport,
  renderModule,
  writeGeneratedFile,
} from './shared'

const GENERATED_BY = 'scripts/indicators/generate-copilot-reference.ts'

const SOURCE_PATHS = {
  entityDocuments: 'apps/tradinggoose/lib/copilot/entity-documents.ts',
  runPineTS: 'apps/tradinggoose/lib/indicators/run-pinets.ts',
  compileIndicator: 'apps/tradinggoose/lib/indicators/custom/compile.ts',
  inputMeta: 'apps/tradinggoose/lib/indicators/input-meta.ts',
  indicatorOptions: 'apps/tradinggoose/lib/indicators/indicator-options.ts',
  triggerBridge: 'apps/tradinggoose/lib/indicators/trigger-bridge.ts',
  unsupported: 'apps/tradinggoose/lib/indicators/unsupported.ts',
  defaultRuntime: 'apps/tradinggoose/lib/indicators/default/runtime.ts',
  generatedPinetsSurface: 'apps/tradinggoose/lib/indicators/generated/pinets-surface.ts',
} as const

const QUERY_TERM_ALIASES = {
  ohlcv: ['open', 'high', 'low', 'close', 'volume'],
  input: ['inputs'],
  inputs: ['input'],
  option: ['options', 'indicator'],
  options: ['option', 'indicator'],
} as const

type SourceReference = {
  label: string
  path: string
}

type MetadataExample = {
  title: string
  summary?: string
  code?: string
  indicatorId?: string
}

type SectionDefinition = {
  id: string
  title: string
  summary: string
  detail: string
  support: 'supported' | 'curated' | 'unsupported'
  sourceReferences: SourceReference[]
}

type ReferenceRecord = {
  id: string
  sectionId?: string
  type:
    | 'section'
    | 'document_field'
    | 'runtime_behavior'
    | 'context_surface'
    | 'input_function'
    | 'indicator_option'
    | 'trigger_api'
    | 'unsupported_feature'
  title: string
  summary: string
  detail: string
  support: 'supported' | 'curated' | 'unsupported'
  signature?: string
  supportedValues?: string[]
  defaultValue?: unknown
  relatedIds?: string[]
  examples?: MetadataExample[]
  sourceReferences?: SourceReference[]
  queryText: string
}

const createSourceReference = (label: string, path: string): SourceReference => ({
  label,
  path,
})

const buildExample = (
  title: string,
  code?: string,
  summary?: string,
  indicatorId?: string
): MetadataExample => ({
  title,
  ...(summary ? { summary } : {}),
  ...(code ? { code } : {}),
  ...(indicatorId ? { indicatorId } : {}),
})

const createRecord = (record: Omit<ReferenceRecord, 'queryText'>): ReferenceRecord => ({
  ...record,
  queryText: [
    record.id,
    record.sectionId,
    record.title,
    record.summary,
    record.detail,
    record.signature,
    ...(record.supportedValues ?? []),
    ...(record.relatedIds ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase(),
})

const toLabel = (value: string) =>
  value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())

const buildInputSummary = (type: string) => `Supported \`input.${type}\` helper.`

const buildInputDetail = (type: string) => {
  if (type === 'int' || type === 'float') {
    return `TradingGoose supports \`input.${type}\` and infers the declared title, default value, and positional numeric constraints into \`inputMeta\`. The saved title becomes the stable runtime override key.`
  }
  if (type === 'enum') {
    return 'TradingGoose supports `input.enum` and keeps the saved title as the stable runtime override key. Helper-specific option lists may still need explicit review in the saved document.'
  }
  return `TradingGoose supports \`input.${type}\` and preserves the saved title as the stable runtime override key in \`inputMeta\`.`
}

const buildInputSignature = (type: string) => {
  switch (type) {
    case 'int':
    case 'float':
      return `input.${type}(defval, title, minval?, maxval?, step?)`
    case 'enum':
      return 'input.enum(defval, title, options?)'
    default:
      return `input.${type}(defval, title)`
  }
}

const buildInputDefaultLiteral = (type: string) => {
  switch (type) {
    case 'any':
    case 'source':
      return 'close'
    case 'int':
      return '14'
    case 'float':
      return '1.5'
    case 'bool':
      return 'true'
    case 'string':
      return "'Example'"
    case 'timeframe':
      return "'60'"
    case 'time':
      return 'time'
    case 'price':
      return '100'
    case 'session':
      return "'0930-1600'"
    case 'symbol':
      return "'NASDAQ:AAPL'"
    case 'text_area':
      return "'Line 1\\nLine 2'"
    case 'enum':
      return "'fast'"
    case 'color':
      return "'#22c55e'"
    default:
      return 'close'
  }
}

const buildInputExample = (type: string) => {
  if (type === 'int') {
    return buildExample(
      'Minimal integer input',
      ["indicator('Example Indicator')", '', "const length = input.int(14, 'Length', 1)"].join('\n')
    )
  }

  if (type === 'enum') {
    return buildExample(
      'Minimal enum input',
      [
        "indicator('Example Indicator')",
        '',
        "const mode = input.enum('fast', 'Mode', ['fast', 'slow'])",
      ].join('\n')
    )
  }

  return buildExample(
    `Minimal ${type} input`,
    [
      "indicator('Example Indicator')",
      '',
      `const value = input.${type}(${buildInputDefaultLiteral(type)}, 'Example ${type}')`,
    ].join('\n')
  )
}

const buildOptionDetail = (key: string) => {
  if (key === 'timeframe') {
    return 'TradingGoose preserves the `timeframe` override and applies timeframe aggregation and expansion during indicator compilation.'
  }
  if (key === 'timeframe_gaps') {
    return 'TradingGoose preserves `timeframe_gaps` and uses it when expanding higher-timeframe output back onto the base series.'
  }
  if (key === 'max_lines_count') {
    return 'TradingGoose preserves `max_lines_count` and truncates normalized series output when the runtime exceeds that limit.'
  }
  if (key === 'max_labels_count') {
    return 'TradingGoose preserves `max_labels_count` and truncates normalized marker output when the runtime exceeds that limit.'
  }
  if (key === 'dynamic_requests') {
    return 'TradingGoose preserves `dynamic_requests`, but still rejects unsupported `request.security` features explicitly.'
  }
  return `TradingGoose preserves \`${key}\` from \`indicator(...)\` into normalized indicator metadata.`
}

const buildOptionExample = (key: string, defaultValue: unknown) =>
  buildExample(
    `indicator option: ${key}`,
    ["indicator('Example Indicator', {", `  ${key}: ${JSON.stringify(defaultValue)},`, '})'].join(
      '\n'
    )
  )

export const generateCopilotIndicatorReference = async () => {
  const pinetsSurface = buildPinetsSurface()
  const indicatorDocumentSchema = getEntityDocumentSchema('indicator')
  const documentFields = Object.keys(indicatorDocumentSchema.shape)
  const defaultExample =
    DEFAULT_INDICATOR_RUNTIME_ENTRIES.find((entry) => entry.id.trim().toLowerCase() === 'rsi') ??
    DEFAULT_INDICATOR_RUNTIME_ENTRIES[0] ??
    null

  const runtimeExample = defaultExample
    ? buildExample(
        defaultExample.name,
        defaultExample.pineCode.trim(),
        'Bundled TradingGoose default indicator example.',
        defaultExample.id
      )
    : undefined

  const sectionDefinitions: SectionDefinition[] = [
    {
      id: 'section:document',
      title: 'Indicator Document',
      summary: 'Saved indicator document format and field-level requirements.',
      detail:
        'TradingGoose saves indicators as JSON documents using `tg-indicator-document-v1`. The canonical field set is derived from the live indicator document schema.',
      support: 'curated',
      sourceReferences: [
        createSourceReference('Indicator document schema', SOURCE_PATHS.entityDocuments),
      ],
    },
    {
      id: 'section:runtime',
      title: 'Runtime Execution',
      summary: 'How TradingGoose runs PineTS and normalizes indicator output.',
      detail:
        'TradingGoose executes indicators through the local PineTS integration, then normalizes plots, fills, markers, triggers, and unsupported metadata into a stable output contract.',
      support: 'curated',
      sourceReferences: [
        createSourceReference('PineTS runner', SOURCE_PATHS.runPineTS),
        createSourceReference('Compile pipeline', SOURCE_PATHS.compileIndicator),
      ],
    },
    {
      id: 'section:context',
      title: 'PineTS Context',
      summary: 'Pinets execution context surface derived from the installed package.',
      detail:
        'This section is generated from the installed Pinets type definitions and augmented with TradingGoose-specific runtime notes.',
      support: 'curated',
      sourceReferences: [
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    },
    {
      id: 'section:inputs',
      title: 'Input Helpers',
      summary: 'Supported `input.*` helpers and local input metadata behavior.',
      detail:
        'TradingGoose supports the configured PineTS input helpers and derives editor/runtime input metadata from live indicator code.',
      support: 'supported',
      sourceReferences: [createSourceReference('Input metadata inference', SOURCE_PATHS.inputMeta)],
    },
    {
      id: 'section:indicator_options',
      title: 'indicator() Options',
      summary: 'Supported `indicator(...)` option keys and local runtime effects.',
      detail:
        'TradingGoose generates this section from the live Pinets option surface, filtered to the options supported by the local indicator runtime.',
      support: 'supported',
      sourceReferences: [
        createSourceReference('Indicator option parser', SOURCE_PATHS.indicatorOptions),
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    },
    {
      id: 'section:triggers',
      title: 'Trigger API',
      summary: 'TradingGoose-specific `trigger(...)` authoring contract.',
      detail:
        'TradingGoose patches PineTS execution to capture indicator trigger events and normalize them into workflow-facing signals.',
      support: 'supported',
      sourceReferences: [createSourceReference('Trigger bridge', SOURCE_PATHS.triggerBridge)],
    },
    {
      id: 'section:unsupported',
      title: 'Unsupported Features',
      summary: 'Known Pine-style features that TradingGoose rejects explicitly.',
      detail:
        'TradingGoose fails fast on unsupported features so Copilot can avoid emitting indicator code that the runtime will reject.',
      support: 'unsupported',
      sourceReferences: [
        createSourceReference('Unsupported feature detector', SOURCE_PATHS.unsupported),
      ],
    },
  ]

  const documentFieldInfo: Record<
    string,
    { summary: string; detail: string; examples?: MetadataExample[]; relatedIds?: string[] }
  > = {
    name: {
      summary: 'Human-readable indicator name in the canonical document.',
      detail:
        'The `name` field is part of the live indicator document schema and is what TradingGoose renames when Copilot updates an indicator title.',
    },
    color: {
      summary: 'Default display color in the canonical document.',
      detail:
        'The `color` field is part of the live indicator document schema and stores the default indicator display color.',
    },
    pineCode: {
      summary: 'PineTS authoring source in the canonical document.',
      detail:
        'The `pineCode` field stores the complete PineTS-compatible indicator source executed by the TradingGoose runtime.',
      ...(runtimeExample ? { examples: [runtimeExample] } : {}),
    },
    inputMeta: {
      summary: 'Saved input-definition map in the canonical document.',
      detail:
        'The `inputMeta` field stores the saved input metadata map used by the editor and runtime override flow. TradingGoose can infer common metadata from `input.*(...)` calls, but the saved document remains the canonical state.',
      relatedIds: ['section:inputs'],
    },
  }

  const runtimeItems = [
    createRecord({
      id: 'runtime.execution',
      sectionId: 'section:runtime',
      type: 'runtime_behavior',
      title: 'Runtime Execution Flow',
      summary: 'How TradingGoose invokes PineTS for one indicator.',
      detail:
        'TradingGoose constructs a PineTS runtime from normalized bars, then executes `new Indicator(code, inputsMap)` and captures the resulting context, transpiled code, trigger signals, and warnings.',
      support: 'curated',
      signature: 'runPineTS({ barsMs, inputsMap, listing, interval, code })',
      sourceReferences: [createSourceReference('PineTS runner', SOURCE_PATHS.runPineTS)],
      ...(runtimeExample ? { examples: [runtimeExample] } : {}),
    }),
    createRecord({
      id: 'runtime.output',
      sectionId: 'section:runtime',
      type: 'runtime_behavior',
      title: 'Normalized Output Contract',
      summary: 'How TradingGoose shapes PineTS output for charts and workflows.',
      detail:
        'TradingGoose normalizes PineTS results into `series`, `fills`, `markers`, `triggers`, and unsupported metadata. Timeframe expansion and output truncation happen in the compile path.',
      support: 'curated',
      sourceReferences: [createSourceReference('Compile pipeline', SOURCE_PATHS.compileIndicator)],
    }),
    createRecord({
      id: 'runtime.input_meta_inference',
      sectionId: 'section:runtime',
      type: 'runtime_behavior',
      title: 'Input Metadata Inference',
      summary: 'How TradingGoose derives editable input metadata from indicator code.',
      detail:
        'TradingGoose scans `input.*(...)` calls, derives the saved input title and common metadata fields, and uses that map as the stable input override contract.',
      support: 'curated',
      relatedIds: ['section:inputs', 'document.inputMeta'],
      sourceReferences: [createSourceReference('Input metadata inference', SOURCE_PATHS.inputMeta)],
    }),
  ]

  const namespaceNames = ['input', 'ta', 'math', 'request', 'array', 'map', 'matrix', 'str', 'log']

  const contextItems = [
    createRecord({
      id: 'context.series',
      sectionId: 'section:context',
      type: 'context_surface',
      title: 'Context Data Series',
      summary: 'Series arrays available to indicator code.',
      detail:
        'This surface is generated from the local Pinets integration and TradingGoose chart conventions. These values are the series-oriented inputs indicator authors typically rely on directly.',
      support: 'curated',
      supportedValues: [...pinetsSurface.dataSeries, ...pinetsSurface.seriesNumbers],
      sourceReferences: [
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    }),
    createRecord({
      id: 'context.namespaces',
      sectionId: 'section:context',
      type: 'context_surface',
      title: 'Context Namespaces',
      summary: 'Helper namespaces exposed during indicator execution.',
      detail:
        'These namespaces are derived from the installed Pinets package and represent the primary Pine-style helper surfaces TradingGoose indicator code can call.',
      support: 'curated',
      supportedValues: namespaceNames,
      sourceReferences: [
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    }),
    createRecord({
      id: 'context.state',
      sectionId: 'section:context',
      type: 'context_surface',
      title: 'Context State Fields',
      summary: 'Execution-state fields on the Pinets context.',
      detail:
        'These fields are generated from the installed Pinets `Context` type and include TradingGoose-relevant execution state such as the current bar index, result containers, timeframe, and symbol identity.',
      support: 'curated',
      supportedValues: pinetsSurface.contextFields,
      sourceReferences: [
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    }),
    createRecord({
      id: 'context.deprecated_getters',
      sectionId: 'section:context',
      type: 'context_surface',
      title: 'Deprecated Context Getters',
      summary: 'Older direct context accessors still exposed by Pinets.',
      detail:
        'Pinets still exposes deprecated direct getters on the context. TradingGoose indicator guidance should prefer the current `context.pine.*` namespace style where possible.',
      support: 'curated',
      supportedValues: pinetsSurface.contextDeprecatedGetters,
      sourceReferences: [
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    }),
  ]

  const documentItems = [
    createRecord({
      id: 'document.format',
      sectionId: 'section:document',
      type: 'document_field',
      title: 'Document Format',
      summary: 'Canonical indicator document format id and top-level field set.',
      detail: `TradingGoose indicator editing tools expect \`${INDICATOR_DOCUMENT_FORMAT}\` JSON with the live field set \`${documentFields.join(', ')}\`.`,
      support: 'curated',
      signature: `${INDICATOR_DOCUMENT_FORMAT} = { ${documentFields.join(', ')} }`,
      relatedIds: documentFields.map((field) => `document.${field}`),
      sourceReferences: [
        createSourceReference('Indicator document schema', SOURCE_PATHS.entityDocuments),
      ],
    }),
    ...documentFields.map((field) =>
      createRecord({
        id: `document.${field}`,
        sectionId: 'section:document',
        type: 'document_field',
        title: `Document Field: ${field}`,
        summary:
          documentFieldInfo[field]?.summary ?? `Saved indicator document field \`${field}\`.`,
        detail:
          documentFieldInfo[field]?.detail ??
          `\`${field}\` is part of the live indicator document schema used by TradingGoose indicator editing tools.`,
        support: 'curated',
        ...(documentFieldInfo[field]?.relatedIds?.length
          ? { relatedIds: documentFieldInfo[field].relatedIds }
          : {}),
        ...(documentFieldInfo[field]?.examples?.length
          ? { examples: documentFieldInfo[field].examples }
          : {}),
        sourceReferences: [
          createSourceReference('Indicator document schema', SOURCE_PATHS.entityDocuments),
        ],
      })
    ),
  ]

  const inputItems = INPUT_TYPES.map((type) =>
    createRecord({
      id: `input.${type}`,
      sectionId: 'section:inputs',
      type: 'input_function',
      title: `input.${type}`,
      summary: buildInputSummary(type),
      detail: buildInputDetail(type),
      support: 'supported',
      signature: buildInputSignature(type),
      relatedIds: ['document.inputMeta'],
      examples: [buildInputExample(type)],
      sourceReferences: [
        createSourceReference('Input metadata inference', SOURCE_PATHS.inputMeta),
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    })
  )

  const indicatorOptionItems = INDICATOR_OPTION_KEYS.map((key) =>
    createRecord({
      id: `indicator.${key}`,
      sectionId: 'section:indicator_options',
      type: 'indicator_option',
      title: `indicator.${key}`,
      summary: `Supported \`indicator(...)\` option \`${key}\`.`,
      detail: buildOptionDetail(key),
      support: 'supported',
      signature: `indicator('Name', { ${key}: ... })`,
      defaultValue: INDICATOR_DEFAULTS[key],
      examples: [buildOptionExample(key, INDICATOR_DEFAULTS[key])],
      sourceReferences: [
        createSourceReference('Indicator option parser', SOURCE_PATHS.indicatorOptions),
        createSourceReference('Generated Pinets surface', SOURCE_PATHS.generatedPinetsSurface),
      ],
    })
  )

  const triggerItems = [
    createRecord({
      id: 'trigger.call',
      sectionId: 'section:triggers',
      type: 'trigger_api',
      title: 'trigger(event, options)',
      summary: 'TradingGoose-specific workflow signal helper for indicators.',
      detail:
        'TradingGoose captures `trigger(event, options)` calls during PineTS execution. `event` must match the configured pattern, `signal` must be one of the supported values, and `position` must be one of the supported marker positions.',
      support: 'supported',
      signature: 'trigger(event, { condition, input, signal, position?, color? })',
      supportedValues: [
        `event: ${String(INDICATOR_TRIGGER_EVENT_PATTERN)}`,
        ...INDICATOR_TRIGGER_VALID_SIGNALS.map((signal) => `signal: ${signal}`),
        ...INDICATOR_TRIGGER_VALID_POSITIONS.map((position) => `position: ${position}`),
      ],
      examples: [
        buildExample(
          'Trigger on bullish cross',
          [
            "indicator('Cross Trigger')",
            '',
            'const fast = ta.ema(close, 9)',
            'const slow = ta.ema(close, 21)',
            "trigger('bullish_cross', {",
            '  condition: ta.crossover(fast, slow),',
            "  input: 'Trend Trigger',",
            "  signal: 'long',",
            "  position: 'aboveBar',",
            "  color: '#22c55e',",
            '})',
          ].join('\n')
        ),
      ],
      sourceReferences: [createSourceReference('Trigger bridge', SOURCE_PATHS.triggerBridge)],
    }),
  ]

  const unsupportedItems = UNSUPPORTED_INDICATOR_FEATURES.map((feature) =>
    createRecord({
      id: `unsupported.${feature.id}`,
      sectionId: 'section:unsupported',
      type: 'unsupported_feature',
      title: feature.id,
      summary: feature.summary,
      detail:
        'TradingGoose detects this feature before execution and reports it as unsupported rather than attempting a partial fallback.',
      support: 'unsupported',
      sourceReferences: [
        createSourceReference('Unsupported feature detector', SOURCE_PATHS.unsupported),
      ],
    })
  )

  const itemRecords = [
    ...documentItems,
    ...runtimeItems,
    ...contextItems,
    ...inputItems,
    ...indicatorOptionItems,
    ...triggerItems,
    ...unsupportedItems,
  ]

  const sectionItemIds = sectionDefinitions.reduce(
    (acc, section) => {
      acc[section.id] = itemRecords
        .filter((item) => item.sectionId === section.id)
        .map((item) => item.id)
      return acc
    },
    {} as Record<string, string[]>
  )

  const sectionRecords = sectionDefinitions.map((section) =>
    createRecord({
      id: section.id,
      type: 'section',
      title: section.title,
      summary: section.summary,
      detail: section.detail,
      support: section.support,
      relatedIds: sectionItemIds[section.id],
      sourceReferences: section.sourceReferences,
    })
  )

  const content = renderModule({
    generatedBy: GENERATED_BY,
    statements: [
      renderConstExport('INDICATOR_REFERENCE_QUERY_TERM_ALIASES', QUERY_TERM_ALIASES),
      '',
      renderConstExport('INDICATOR_REFERENCE_SECTION_DEFINITIONS', sectionDefinitions),
      '',
      renderConstExport('INDICATOR_REFERENCE_SECTION_RECORDS', sectionRecords),
      '',
      renderConstExport('INDICATOR_REFERENCE_ITEM_RECORDS', itemRecords),
    ],
  })

  const changed = writeGeneratedFile(OUTPUT_PATHS.copilotIndicatorReference, content)
  if (changed) {
    console.log(`Wrote ${OUTPUT_PATHS.copilotIndicatorReference}`)
  } else {
    console.log('Indicator Copilot reference artifact is up to date.')
  }
}

if (import.meta.main) {
  await generateCopilotIndicatorReference()
}
