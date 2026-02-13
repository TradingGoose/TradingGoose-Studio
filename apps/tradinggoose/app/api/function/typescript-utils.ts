import { FUNCTION_INDICATOR_USAGE_HINT } from '@/lib/indicators/execution/function-indicator-runtime'

type TypeScriptModule = typeof import('typescript')

let typescriptModulePromise: Promise<TypeScriptModule> | null = null

const loadTypeScriptModule = async (): Promise<TypeScriptModule> => {
  if (!typescriptModulePromise) {
    typescriptModulePromise = import('typescript').then((mod) => {
      const tsModule = (mod?.default ?? mod) as TypeScriptModule
      return tsModule
    })
  }

  return typescriptModulePromise
}

export const findFunctionPineDisallowedReason = async (
  code: string
): Promise<string | undefined> => {
  const tsModule = await loadTypeScriptModule()
  const sourceFile = tsModule.createSourceFile(
    'user-function.ts',
    code,
    tsModule.ScriptTarget.Latest,
    true,
    tsModule.ScriptKind.TS
  )

  let disallowedReason: string | undefined

  const setDisallowedReason = (reason: string) => {
    if (!disallowedReason) {
      disallowedReason = reason
    }
  }

  const visitNode = (node: any) => {
    if (disallowedReason) return

    if (tsModule.isImportDeclaration(node)) {
      if (
        tsModule.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.trim().toLowerCase() === 'pinets'
      ) {
        setDisallowedReason(
          `Importing "pinets" in Function block is disabled. ${FUNCTION_INDICATOR_USAGE_HINT}`
        )
        return
      }
    }

    if (tsModule.isCallExpression(node)) {
      if (tsModule.isIdentifier(node.expression) && node.expression.text === 'indicator') {
        setDisallowedReason(
          `Direct Pine indicator definitions are disabled in Function block. ${FUNCTION_INDICATOR_USAGE_HINT}`
        )
        return
      }

      if (node.expression.kind === tsModule.SyntaxKind.ImportKeyword) {
        const moduleArg = node.arguments[0]
        if (
          moduleArg &&
          tsModule.isStringLiteral(moduleArg) &&
          moduleArg.text.trim().toLowerCase() === 'pinets'
        ) {
          setDisallowedReason(
            `Dynamic import of "pinets" is disabled in Function block. ${FUNCTION_INDICATOR_USAGE_HINT}`
          )
          return
        }
      }

      if (
        tsModule.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        node.arguments.length > 0
      ) {
        const moduleArg = node.arguments[0]
        if (
          moduleArg &&
          tsModule.isStringLiteral(moduleArg) &&
          moduleArg.text.trim().toLowerCase() === 'pinets'
        ) {
          setDisallowedReason(
            `require("pinets") is disabled in Function block. ${FUNCTION_INDICATOR_USAGE_HINT}`
          )
          return
        }
      }
    }

    if (
      tsModule.isNewExpression(node) &&
      tsModule.isIdentifier(node.expression) &&
      (node.expression.text === 'PineTS' || node.expression.text === 'Indicator')
    ) {
      setDisallowedReason(
        `Direct PineTS runtime usage is disabled in Function block. ${FUNCTION_INDICATOR_USAGE_HINT}`
      )
      return
    }

    tsModule.forEachChild(node, visitNode)
  }

  visitNode(sourceFile)

  return disallowedReason
}

export const extractJavaScriptImports = async (
  code: string,
  onError?: (error: unknown) => void
): Promise<{ imports: string; remainingCode: string; importLineCount: number }> => {
  try {
    const tsModule = await loadTypeScriptModule()

    const sourceFile = tsModule.createSourceFile(
      'user-code.js',
      code,
      tsModule.ScriptTarget.Latest,
      true,
      tsModule.ScriptKind.JS
    )

    const importSegments: Array<{ text: string; start: number; end: number }> = []

    sourceFile.statements.forEach((statement) => {
      if (
        tsModule.isImportDeclaration(statement) ||
        tsModule.isImportEqualsDeclaration(statement)
      ) {
        importSegments.push({
          text: statement.getFullText(sourceFile).trim(),
          start: statement.getFullStart(),
          end: statement.getEnd(),
        })
      }
    })

    if (importSegments.length === 0) {
      return { imports: '', remainingCode: code, importLineCount: 0 }
    }

    importSegments.sort((a, b) => a.start - b.start)

    const imports = importSegments.map((segment) => segment.text).join('\n')

    let cursor = 0
    const parts: string[] = []
    let importLineCount = 0

    for (const segment of importSegments) {
      if (segment.start > cursor) {
        parts.push(code.slice(cursor, segment.start))
      }

      const removedSegment = code.slice(segment.start, segment.end)
      importLineCount += removedSegment.split('\n').length - 1

      const newlinePlaceholder = removedSegment.replace(/[^\n]/g, '')
      parts.push(newlinePlaceholder)

      cursor = segment.end
    }

    if (cursor < code.length) {
      parts.push(code.slice(cursor))
    }

    const remainingCode = parts.join('')

    return { imports, remainingCode, importLineCount: Math.max(importLineCount, 0) }
  } catch (error) {
    onError?.(error)
    return { imports: '', remainingCode: code, importLineCount: 0 }
  }
}

export const transpileTypeScriptCode = async (code: string): Promise<string> => {
  const tsModule = await loadTypeScriptModule()
  const transpiled = tsModule.transpileModule(code, {
    fileName: 'user-function.ts',
    compilerOptions: {
      target: tsModule.ScriptTarget.ES2020,
      module: tsModule.ModuleKind.ESNext,
      moduleResolution: tsModule.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
    },
  })
  return transpiled.outputText
}
