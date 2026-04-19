import { describe, expect, it } from 'vitest'
import {
  buildMonacoIndicatorDiagnosticSource,
  buildMonacoScriptDiagnosticSource,
  createMonacoFunctionBodyDiagnosticSourceBuilder,
  sanitizeMonacoDiagnosticSource,
} from '@/components/monaco-editor/monaco-editor-diagnostics'

describe('monaco-editor-diagnostics', () => {
  it('sanitizes workflow placeholders into stable identifiers', () => {
    const result = sanitizeMonacoDiagnosticSource(
      'await indicator.RSI(<historical.data>) + {{MARKET_API_KEY}}'
    )

    expect(result.content).toBe(
      'await indicator.RSI($historical$data$) + $$MARKET_API_KEY$$'
    )
    expect(result.placeholderIdentifiers).toEqual([
      '$historical$data$',
      '$$MARKET_API_KEY$$',
    ])
  })

  it('wraps function-body diagnostics in an async module body', () => {
    const builder = createMonacoFunctionBodyDiagnosticSourceBuilder({
      language: 'typescript',
      parameterNames: ['symbol', 'invalid-name'],
    })
    const result = builder('const output = await indicator.RSI(<series>)\nreturn output', {
      language: 'typescript',
      path: 'inmemory://model/function.ts',
    })

    expect(result).not.toBeNull()
    expect(result?.language).toBe('typescript')
    expect(result?.userCodeStartLine).toBeGreaterThan(1)
    expect(result?.content).toContain('export {}')
    expect(result?.content).toContain('declare const params: Record<string, any>')
    expect(result?.content).toContain('declare const symbol: any')
    expect(result?.content).not.toContain('declare const invalid-name: any')
    expect(result?.content).toContain('async function __tg_function_body__() {')
    expect(result?.content).toContain('const output = await indicator.RSI($series$)')
  })

  it('wraps indicator diagnostics in a scoped async body', () => {
    const result = buildMonacoIndicatorDiagnosticSource(
      "const length = input.int(20, 'Length')",
      {
        language: 'typescript',
        path: 'inmemory://model/pine-indicator.ts',
      }
    )

    expect(result).not.toBeNull()
    expect(result?.userCodeStartLine).toBe(3)
    expect(result?.content).toContain('async function __tg_indicator_body__() {')
    expect(result?.content).toContain("const length = input.int(20, 'Length')")
  })

  it('keeps raw script diagnostics available without forcing module semantics', () => {
    const result = buildMonacoScriptDiagnosticSource('<response> === true', {
      language: 'javascript',
      path: 'inmemory://model/condition.js',
    })

    expect(result).not.toBeNull()
    expect(result?.userCodeStartLine).toBe(2)
    expect(result?.content).toContain('declare const $response$: any')
    expect(result?.content).toContain('$response$ === true')
    expect(result?.content).not.toContain('export {}')
  })
})
