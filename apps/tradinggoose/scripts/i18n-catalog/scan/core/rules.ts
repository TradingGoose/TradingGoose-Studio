export const HARD_CODED_PROP_NAMES = new Set([
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'label',
  'description',
  'helperText',
  'tooltip',
])

export const ARRAY_CONSUMER_METHOD_NAMES = new Set([
  'at',
  'concat',
  'entries',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'map',
  'reduce',
  'reduceRight',
  'slice',
  'some',
  'toReversed',
  'toSorted',
  'toSpliced',
  'values',
  'with',
])

export const ARRAY_RUNTIME_CALLBACK_METHOD_NAMES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'toSorted',
])

export const STRING_CONSUMER_METHOD_NAMES = new Set([
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimStart',
  'trimEnd',
  'normalize',
  'replace',
  'replaceAll',
  'slice',
  'substring',
  'includes',
  'startsWith',
  'endsWith',
  'split',
  'match',
  'search',
  'localeCompare',
  'padStart',
  'padEnd',
])

export const RUNTIME_CALLBACK_HOOK_NAMES = new Set([
  'useEffect',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
])

export const RUNTIME_CALLBACK_FUNCTION_NAMES = new Set([
  'queueMicrotask',
  'requestAnimationFrame',
  'startTransition',
  'setInterval',
  'setTimeout',
])

export const ROOT_HINT_NAME = /(^copy$|Copy$|^messages$|Messages$|^widgetsCopy$|^monitorCopy$)/i

export const METADATA_PROP_NAMES = new Set(['title', 'description', 'alt'])
