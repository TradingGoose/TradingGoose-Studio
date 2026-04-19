import type {
  MonacoDiagnosticLanguage,
  MonacoDiagnosticSource,
  MonacoDiagnosticSourceBuilder,
} from '@/components/monaco-editor/monaco-editor-types'

type PlaceholderMatch = {
  start: number
  end: number
  replacement: string
}

type SanitizedDiagnosticSource = {
  content: string
  placeholderIdentifiers: string[]
}

const ENV_VARIABLE_REGEX = /\{\{[^}\s]+\}\}/g

const isIdentifierStart = (char?: string) => !!char && /[A-Za-z_$]/.test(char)
const isIdentifierPart = (char?: string) => !!char && /[A-Za-z0-9_$]/.test(char)
const isPlaceholderStartChar = (char?: string) => !!char && /[A-Za-z_]/.test(char)
const isInvalidPlaceholderPrefix = (char?: string) => !!char && /[A-Za-z0-9_$\]\)\}]/.test(char)
const isValidIdentifier = (value: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)

const toPlaceholderIdentifier = (token: string) =>
  token
    .split('')
    .map((char, index) => {
      if (index === 0) {
        return isIdentifierStart(char) ? char : '$'
      }
      return isIdentifierPart(char) ? char : '$'
    })
    .join('')

const findAnglePlaceholderMatches = (source: string): PlaceholderMatch[] => {
  const matches: PlaceholderMatch[] = []

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '<') continue
    const nextChar = source[index + 1]
    if (!isPlaceholderStartChar(nextChar)) continue

    let previousIndex = index - 1
    while (previousIndex >= 0 && /\s/.test(source[previousIndex])) {
      previousIndex -= 1
    }
    if (isInvalidPlaceholderPrefix(source[previousIndex])) continue

    let end = index + 1
    while (end < source.length) {
      const char = source[end]
      if (char === '>') {
        end += 1
        break
      }
      if (/\s/.test(char)) {
        end = index
        break
      }
      end += 1
    }

    if (end <= index + 1) continue

    matches.push({
      start: index,
      end,
      replacement: toPlaceholderIdentifier(source.slice(index, end)),
    })
    index = end - 1
  }

  return matches
}

const collectPlaceholderMatches = (source: string): PlaceholderMatch[] => {
  const matches: PlaceholderMatch[] = []
  let envMatch: RegExpExecArray | null

  while ((envMatch = ENV_VARIABLE_REGEX.exec(source)) !== null) {
    matches.push({
      start: envMatch.index,
      end: envMatch.index + envMatch[0].length,
      replacement: toPlaceholderIdentifier(envMatch[0]),
    })
  }

  matches.push(...findAnglePlaceholderMatches(source))
  matches.sort((left, right) => left.start - right.start || left.end - right.end)

  const deduped: PlaceholderMatch[] = []
  let previousEnd = -1

  for (const match of matches) {
    if (match.start < previousEnd) continue
    deduped.push(match)
    previousEnd = match.end
  }

  return deduped
}

export const sanitizeMonacoDiagnosticSource = (source: string): SanitizedDiagnosticSource => {
  const matches = collectPlaceholderMatches(source)
  if (matches.length === 0) {
    return {
      content: source,
      placeholderIdentifiers: [],
    }
  }

  const parts: string[] = []
  const placeholderIdentifiers = new Set<string>()
  let cursor = 0

  for (const match of matches) {
    parts.push(source.slice(cursor, match.start))
    parts.push(match.replacement)
    placeholderIdentifiers.add(match.replacement)
    cursor = match.end
  }

  parts.push(source.slice(cursor))

  return {
    content: parts.join(''),
    placeholderIdentifiers: [...placeholderIdentifiers],
  }
}

const buildDiagnosticSource = ({
  sanitizedSource,
  language,
  prefixLines,
  suffixLines = [],
}: {
  sanitizedSource: SanitizedDiagnosticSource
  language: MonacoDiagnosticLanguage
  prefixLines: string[]
  suffixLines?: string[]
}): MonacoDiagnosticSource => {
  return {
    content: [...prefixLines, sanitizedSource.content, ...suffixLines].join('\n'),
    language,
    fileExtension: language === 'typescript' ? 'ts' : 'js',
    userCodeStartLine: prefixLines.length + 1,
    userCodeLength: sanitizedSource.content.length,
  }
}

const buildPlaceholderDeclarationLines = (placeholderIdentifiers: string[]) =>
  placeholderIdentifiers.map(
    (identifier) => `declare const ${identifier}: any`
  )

export const isMonacoDiagnosticLanguage = (
  language: string
): language is MonacoDiagnosticLanguage => language === 'javascript' || language === 'typescript'

export const buildMonacoScriptDiagnosticSource: MonacoDiagnosticSourceBuilder = (
  source,
  context
) => {
  const sanitizedSource = sanitizeMonacoDiagnosticSource(source)

  return buildDiagnosticSource({
    sanitizedSource,
    language: context.language,
    prefixLines: buildPlaceholderDeclarationLines(sanitizedSource.placeholderIdentifiers),
  })
}

export const createMonacoFunctionBodyDiagnosticSourceBuilder = ({
  language,
  parameterNames = [],
}: {
  language?: MonacoDiagnosticLanguage
  parameterNames?: string[]
} = {}): MonacoDiagnosticSourceBuilder => {
  return (source, context) => {
    const sanitizedSource = sanitizeMonacoDiagnosticSource(source)

    return buildDiagnosticSource({
      sanitizedSource,
      language: language ?? context.language,
      prefixLines: [
        'export {}',
        'declare const params: Record<string, any>',
        'declare const environmentVariables: Record<string, string>',
        'interface TradingGooseIndicatorRuntime {',
        '  list(): string[]',
        '  [indicatorId: string]: any',
        '}',
        'declare const indicator: TradingGooseIndicatorRuntime',
        ...buildPlaceholderDeclarationLines(sanitizedSource.placeholderIdentifiers),
        ...parameterNames
          .filter(isValidIdentifier)
          .map((name) => `declare const ${name}: any`),
        'async function __tg_function_body__() {',
      ],
      suffixLines: ['}'],
    })
  }
}

export const buildMonacoIndicatorDiagnosticSource: MonacoDiagnosticSourceBuilder = (
  source,
  context
) => {
  const sanitizedSource = sanitizeMonacoDiagnosticSource(source)

  return buildDiagnosticSource({
    sanitizedSource,
    language: context.language,
    prefixLines: [
      'export {}',
      ...buildPlaceholderDeclarationLines(sanitizedSource.placeholderIdentifiers),
      'async function __tg_indicator_body__() {',
    ],
    suffixLines: ['}'],
  })
}
