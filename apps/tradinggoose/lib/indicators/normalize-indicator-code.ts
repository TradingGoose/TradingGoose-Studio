import * as ts from 'typescript'

export const looksLikeFunctionExpression = (code: string): boolean => {
  const trimmed = code.trim()
  if (!trimmed) return false
  if (/^async\s+function\b/.test(trimmed) || /^function\b/.test(trimmed)) return true
  if (/^async\s+\([^)]*\)\s*=>/.test(trimmed)) return true
  if (/^\([^)]*\)\s*=>/.test(trimmed)) return true
  if (/^async\s+[_$a-zA-Z][\w$]*\s*=>/.test(trimmed)) return true
  if (/^[_$a-zA-Z][\w$]*\s*=>/.test(trimmed)) return true
  return false
}

export const transpileTypeScript = (code: string): { code: string; error?: string } => {
  if (!code) return { code: '' }
  try {
    const result = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2019,
        module: ts.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    })
    const diagnostics = result.diagnostics ?? []
    const errorMessages = diagnostics
      .filter((diag) => diag.category === ts.DiagnosticCategory.Error)
      .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, '\n'))
      .filter(Boolean)

    let output = result.outputText ?? code
    output = output.replace(/^\s*export\s*\{\s*\};?\s*$/gm, '')
    output = output.trimEnd()

    if (errorMessages.length > 0) {
      const joined = errorMessages.join('; ')
      const prefixed = joined.includes('typescript') ? joined : `typescript ${joined}`
      return { code: output, error: prefixed }
    }

    return { code: output }
  } catch (error) {
    return {
      code,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function normalizeIndicatorCode(pineCode: string) {
  const transpiled = transpileTypeScript(pineCode ?? '')
  const trimmed = transpiled.code.trim()

  if (!trimmed) {
    return {
      code: '',
      error: transpiled.error ?? 'empty code',
      transpiledCode: transpiled.code,
    }
  }

  const wrapped = looksLikeFunctionExpression(trimmed)
    ? trimmed.replace(/;+\s*$/, '')
    : `($) => {\n${trimmed}\n}`

  return {
    code: wrapped,
    error: transpiled.error,
    transpiledCode: transpiled.code,
  }
}
