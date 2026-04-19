'use client'

import { loader } from '@monaco-editor/react'
import dynamic from 'next/dynamic'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditorTypes, IDisposable } from 'monaco-editor'
import { cn } from '@/lib/utils'
import {
  buildMonacoScriptDiagnosticSource,
  isMonacoDiagnosticLanguage,
} from '@/components/monaco-editor/monaco-editor-diagnostics'
import { ensureMonacoEnvironment } from '@/components/monaco-editor/monaco-editor-environment'
import { defineMonacoThemes, getIsDark } from '@/components/monaco-editor/monaco-editor-theme'
import type {
  MonacoEditorHandle,
  MonacoEditorProps,
  MonacoInjectedText,
  MonacoModule,
} from '@/components/monaco-editor/monaco-editor-types'

const MonacoReactEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })
const VIRTUAL_DIAGNOSTICS_OWNER = 'tradinggoose-virtual-diagnostics'
const NATIVE_DIAGNOSTIC_OWNERS = ['typescript', 'javascript'] as const

type MonacoTypeScriptDefaults = {
  addExtraLib: (content: string, filePath?: string) => IDisposable
  getCompilerOptions: () => Record<string, unknown>
  setCompilerOptions: (options: Record<string, unknown>) => void
  setDiagnosticsOptions: (options: Record<string, unknown>) => void
}

type MonacoTypeScriptNamespace = {
  typescriptDefaults?: MonacoTypeScriptDefaults
  javascriptDefaults?: MonacoTypeScriptDefaults
  JsxEmit?: { None?: unknown }
  ModuleKind?: { ESNext?: unknown }
  getTypeScriptWorker?: () => Promise<(...uris: unknown[]) => Promise<any>>
  getJavaScriptWorker?: () => Promise<(...uris: unknown[]) => Promise<any>>
}

const parsePx = (value?: string | number): number | undefined => {
  if (typeof value === 'number') return value
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed.endsWith('px')) {
    return undefined
  }

  const parsed = Number.parseFloat(trimmed.slice(0, -2))
  return Number.isNaN(parsed) ? undefined : parsed
}

const flattenDiagnosticMessageText = (
  message: string | { messageText: string; next?: Array<{ messageText: string; next?: any[] }> }
): string => {
  if (typeof message === 'string') {
    return message
  }

  const nextMessages = Array.isArray(message.next)
    ? message.next.map((entry) => flattenDiagnosticMessageText(entry)).filter(Boolean)
    : []

  return [message.messageText, ...nextMessages].join('\n')
}

const getTypeScriptNamespace = (monaco: MonacoModule): MonacoTypeScriptNamespace | undefined => {
  const monacoWithTypeScript = monaco as MonacoModule & {
    languages?: { typescript?: MonacoTypeScriptNamespace }
    typescript?: MonacoTypeScriptNamespace
  }

  return monacoWithTypeScript.typescript ?? monacoWithTypeScript.languages?.typescript
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  (
    {
      value,
      onChange,
      language = 'javascript',
      placeholder,
      className,
      height,
      minHeight,
      maxHeight,
      options,
      readOnly = false,
      disabled = false,
      decorations = [],
      onCursorChange,
      onKeyDown,
      onKeyUp,
      onClick,
      onBlur,
      onFocus,
      autoHeight = false,
      extraLibs = [],
      path,
      yText,
      awareness,
      diagnosticSourceBuilder,
    },
    ref
  ) => {
    const editorRef = useRef<MonacoEditorTypes.IStandaloneCodeEditor | null>(null)
    const monacoRef = useRef<MonacoModule | null>(null)
    const decorationIdsRef = useRef<string[]>([])
    const subscriptionsRef = useRef<IDisposable[]>([])
    const extraLibsRef = useRef<IDisposable[]>([])
    const containerRef = useRef<HTMLDivElement | null>(null)
    const modelPathRef = useRef<string | null>(null)
    const diagnosticsModelIdRef = useRef<string | null>(null)
    const diagnosticsModelRef = useRef<MonacoEditorTypes.ITextModel | null>(null)
    const diagnosticsModelPathRef = useRef<string | null>(null)
    const diagnosticsRunIdRef = useRef(0)
    const [monacoInstance, setMonacoInstance] = useState<MonacoModule | null>(null)
    const [editorReady, setEditorReady] = useState(false)
    const [placeholderOffset, setPlaceholderOffset] = useState({ top: 8, left: 12 })
    const [autoHeightPx, setAutoHeightPx] = useState<number | undefined>(
      autoHeight ? parsePx(minHeight) : undefined
    )
    const [theme, setTheme] = useState(() => (getIsDark() ? 'vs-dark' : 'vs'))

    const minHeightPx = parsePx(minHeight)
    const maxHeightPx = parsePx(maxHeight)
    const resolvedPath = useMemo(() => {
      if (path) return path
      const extension =
        language === 'typescript'
          ? 'ts'
          : language === 'json'
            ? 'json'
            : language === 'python'
              ? 'py'
              : language === 'sql'
                ? 'sql'
                : language === 'html'
                  ? 'html'
                  : language === 'plaintext'
                    ? 'txt'
              : 'js'
      const current = modelPathRef.current
      if (current && current.endsWith(`.${extension}`)) return current
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      const nextPath = `inmemory://model/monaco-${id}.${extension}`
      modelPathRef.current = nextPath
      return nextPath
    }, [language, path])

    const resolvedHeight = useMemo(() => {
      if (autoHeight) {
        if (typeof autoHeightPx === 'number') return autoHeightPx
        return minHeightPx || 0
      }
      if (height !== undefined) return height
      if (minHeight !== undefined) return minHeight
      return '100%'
    }, [autoHeight, autoHeightPx, height, minHeight, minHeightPx])
    const hasValue = Boolean(value)

    const updatePlaceholderOffset = () => {
      const editor = editorRef.current
      if (!editor) return
      const info = editor.getLayoutInfo()
      const monaco = monacoRef.current
      const padding = monaco ? editor.getOption(monaco.editor.EditorOption.padding) : undefined
      const topPadding =
        padding && typeof padding === 'object' && Number.isFinite(padding.top) ? padding.top : 0
      const nextTop = Number.isFinite(topPadding) ? topPadding + 8 : 8
      const nextLeft = Number.isFinite(info.contentLeft) ? info.contentLeft + 8 : 12
      setPlaceholderOffset({
        top: nextTop,
        left: nextLeft,
      })
    }

    const updateAutoHeight = () => {
      if (!autoHeight) return
      const editor = editorRef.current
      if (!editor) return
      const contentHeight = editor.getContentHeight()
      const minPx = minHeightPx ?? 0
      const maxPx = maxHeightPx ?? Number.POSITIVE_INFINITY
      const nextHeight = Math.min(maxPx, Math.max(minPx, contentHeight))
      setAutoHeightPx(nextHeight)
      const layout = editor.getLayoutInfo()
      editor.layout({ width: layout.width, height: nextHeight })
    }

    const applyDecorations = () => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco) return
      const model = editor.getModel()
      if (!model) return
      const maxOffset = model.getValueLength()
      const injectedCursorStops = monaco.editor.InjectedTextCursorStops

      const nextDecorations = decorations
        .map((decoration) => {
          const start = Math.max(0, Math.min(decoration.startOffset, maxOffset))
          const end = Math.max(start, Math.min(decoration.endOffset, maxOffset))
          const startPos = model.getPositionAt(start)
          const endPos = model.getPositionAt(end)
          const resolveCursorStops = (
            value?: MonacoInjectedText['cursorStops']
          ): MonacoEditorTypes.InjectedTextCursorStops | undefined => {
            if (!value) return undefined
            switch (value) {
              case 'left':
                return injectedCursorStops.Left
              case 'right':
                return injectedCursorStops.Right
              case 'none':
                return injectedCursorStops.None
              case 'both':
              default:
                return injectedCursorStops.Both
            }
          }
          return {
            range: new monaco.Range(
              startPos.lineNumber,
              startPos.column,
              endPos.lineNumber,
              endPos.column
            ),
            options: {
              inlineClassName: decoration.className,
              inlineClassNameAffectsLetterSpacing:
                decoration.inlineClassNameAffectsLetterSpacing,
              before: decoration.before
                ? {
                  content: decoration.before.content,
                  inlineClassName: decoration.before.className ?? null,
                  inlineClassNameAffectsLetterSpacing:
                    decoration.before.inlineClassNameAffectsLetterSpacing,
                  cursorStops: resolveCursorStops(decoration.before.cursorStops),
                }
                : null,
              after: decoration.after
                ? {
                  content: decoration.after.content,
                  inlineClassName: decoration.after.className ?? null,
                  inlineClassNameAffectsLetterSpacing:
                    decoration.after.inlineClassNameAffectsLetterSpacing,
                  cursorStops: resolveCursorStops(decoration.after.cursorStops),
                }
                : null,
            },
          }
        })
        .filter(Boolean)

      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, nextDecorations)
    }

    const getTypeScriptDefaults = (monaco: MonacoModule) => {
      const tsNamespace = getTypeScriptNamespace(monaco)

      return {
        tsDefaults: tsNamespace?.typescriptDefaults,
        jsDefaults: tsNamespace?.javascriptDefaults,
        jsxEmit: tsNamespace?.JsxEmit,
        moduleKind: tsNamespace?.ModuleKind,
      }
    }

    const configureTypeScriptDefaults = (monaco: MonacoModule) => {
      const { tsDefaults, jsDefaults, jsxEmit, moduleKind } = getTypeScriptDefaults(monaco)
      const applyCompilerOptions = (defaults?: typeof tsDefaults) => {
        if (!defaults) return
        defaults.setCompilerOptions({
          ...defaults.getCompilerOptions(),
          allowJs: true,
          allowNonTsExtensions: true,
          allowTopLevelReturn: true,
          checkJs: false,
          noImplicitAny: false,
          suppressImplicitAnyIndexErrors: true,
          ...(jsxEmit?.None ? { jsx: jsxEmit.None } : {}),
          ...(moduleKind?.ESNext ? { module: moduleKind.ESNext } : {}),
        })
      }
      const applyDiagnosticsOptions = (defaults?: typeof tsDefaults) => {
        if (!defaults) return
        defaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
          noSuggestionDiagnostics: true,
        })
      }
      applyCompilerOptions(tsDefaults)
      applyCompilerOptions(jsDefaults)
      applyDiagnosticsOptions(tsDefaults)
      applyDiagnosticsOptions(jsDefaults)
    }

    const clearModelDiagnostics = (model?: MonacoEditorTypes.ITextModel | null) => {
      const monaco = monacoRef.current
      if (!monaco || !model) return

      monaco.editor.setModelMarkers(model, VIRTUAL_DIAGNOSTICS_OWNER, [])
      NATIVE_DIAGNOSTIC_OWNERS.forEach((owner) => {
        monaco.editor.setModelMarkers(model, owner, [])
      })
    }

    const disposeDiagnosticsModel = () => {
      diagnosticsModelRef.current?.dispose()
      diagnosticsModelRef.current = null
      diagnosticsModelPathRef.current = null
    }

    useImperativeHandle(ref, () => ({
      getEditor: () => editorRef.current,
      focus: () => editorRef.current?.focus(),
      getCursorOffset: () => {
        const editor = editorRef.current
        const model = editor?.getModel()
        const position = editor?.getPosition()
        if (!editor || !model || !position) return 0
        return model.getOffsetAt(position)
      },
      setCursorOffset: (offset: number) => {
        const editor = editorRef.current
        const model = editor?.getModel()
        if (!editor || !model) return
        const position = model.getPositionAt(offset)
        editor.setPosition(position)
        editor.setSelection({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })
      },
      getCursorPosition: () => editorRef.current?.getPosition() ?? null,
      getCursorCoords: () => {
        const editor = editorRef.current
        const position = editor?.getPosition()
        if (!editor || !position) return null
        const coords = editor.getScrolledVisiblePosition(position)
        if (!coords) return null
        const top = coords.top
        const left = coords.left
        const height = coords.height
        if (!Number.isFinite(top) || !Number.isFinite(left) || !Number.isFinite(height)) {
          return null
        }
        return { top, left, height }
      },
      insertTextAtCursor: (text: string) => {
        const editor = editorRef.current
        const model = editor?.getModel()
        const monaco = monacoRef.current
        if (!editor || !model || !monaco) return
        const selection = editor.getSelection()
        const position = editor.getPosition()
        const range =
          selection ??
          new monaco.Range(
            position?.lineNumber ?? 1,
            position?.column ?? 1,
            position?.lineNumber ?? 1,
            position?.column ?? 1
          )
        editor.executeEdits('insert-text', [
          {
            range,
            text,
            forceMoveMarkers: true,
          },
        ])
        editor.focus()
      },
    }))

    useEffect(() => {
      if (typeof window === 'undefined') return
      let isActive = true
      ensureMonacoEnvironment()

      Promise.all([
        import('monaco-editor'),
        import('monaco-editor/esm/vs/language/json/monaco.contribution'),
        import('monaco-editor/esm/vs/language/css/monaco.contribution'),
        import('monaco-editor/esm/vs/language/html/monaco.contribution'),
        import('monaco-editor/esm/vs/language/typescript/monaco.contribution'),
        import('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'),
        import('monaco-editor/esm/vs/basic-languages/python/python.contribution'),
        import('monaco-editor/esm/vs/basic-languages/sql/sql.contribution'),
      ])
        .then(([monaco]) => {
          if (!isActive) return
          loader.config({ monaco })
          setMonacoInstance(monaco)
        })
        .catch((error) => {
          console.error('Monaco initialization failed', error)
        })

      return () => {
        isActive = false
      }
    }, [])

    useEffect(() => {
      if (typeof document === 'undefined') return
      const updateTheme = () => {
        const nextTheme = getIsDark() ? 'tg-dark' : 'tg-light'
        setTheme(nextTheme)
        const monaco = monacoRef.current
        if (monaco) {
          defineMonacoThemes(monaco)
          monaco.editor.setTheme(nextTheme)
        }
      }
      updateTheme()
      const observer = new MutationObserver(updateTheme)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
      return () => observer.disconnect()
    }, [])

    useEffect(() => {
      if (!monacoInstance) return
      defineMonacoThemes(monacoInstance)
      const nextTheme = getIsDark() ? 'tg-dark' : 'tg-light'
      monacoInstance.editor.setTheme(nextTheme)
      setTheme(nextTheme)
    }, [monacoInstance])

    useEffect(() => {
      if (!monacoInstance) return
      configureTypeScriptDefaults(monacoInstance)
    }, [monacoInstance])

    useEffect(() => {
      const monaco = monacoInstance
      if (!monaco) return
      const { tsDefaults, jsDefaults } = getTypeScriptDefaults(monaco)
      if (!tsDefaults && !jsDefaults) return
      extraLibsRef.current.forEach((lib) => lib.dispose())
      extraLibsRef.current = []
      if (!extraLibs || extraLibs.length === 0) return
      const targets = [tsDefaults, jsDefaults].filter(Boolean)
      extraLibsRef.current = targets.flatMap((target) =>
        extraLibs.map((lib, index) =>
          target!.addExtraLib(
            lib.content,
            lib.filePath ?? `inmemory://model/extra-lib-${index}.d.ts`
          )
        )
      )
      return () => {
        extraLibsRef.current.forEach((lib) => lib.dispose())
        extraLibsRef.current = []
      }
    }, [extraLibs, monacoInstance])

    useEffect(() => {
      if (!editorReady) return

      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco) return

      let cancelled = false
      let timeoutId: number | null = null

      const runVirtualDiagnostics = async () => {
        const runId = ++diagnosticsRunIdRef.current
        const visibleModel = editor.getModel()
        if (!visibleModel) return

        const visibleLanguage = visibleModel.getLanguageId()
        if (!isMonacoDiagnosticLanguage(visibleLanguage)) {
          clearModelDiagnostics(visibleModel)
          disposeDiagnosticsModel()
          return
        }

        const diagnosticBuilder = diagnosticSourceBuilder ?? buildMonacoScriptDiagnosticSource
        const diagnosticSource = diagnosticBuilder(editor.getValue(), {
          language: visibleLanguage,
          path: visibleModel.uri.toString(),
        })

        if (!diagnosticSource) {
          clearModelDiagnostics(visibleModel)
          disposeDiagnosticsModel()
          return
        }

        const hiddenModelExtension =
          diagnosticSource.fileExtension ??
          (diagnosticSource.language === 'typescript' ? 'ts' : 'js')
        const diagnosticsModelId =
          diagnosticsModelIdRef.current ??
          (typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2))
        diagnosticsModelIdRef.current = diagnosticsModelId
        const hiddenModelPath = monaco.Uri.from({
          scheme: 'inmemory',
          authority: 'diagnostics',
          path: `/monaco-${diagnosticsModelId}.${hiddenModelExtension}`,
        }).toString()

        if (diagnosticsModelPathRef.current !== hiddenModelPath) {
          disposeDiagnosticsModel()
        }

        let diagnosticsModel = diagnosticsModelRef.current
        if (!diagnosticsModel) {
          diagnosticsModel = monaco.editor.createModel(
            diagnosticSource.content,
            diagnosticSource.language,
            monaco.Uri.parse(hiddenModelPath)
          )
          diagnosticsModelRef.current = diagnosticsModel
          diagnosticsModelPathRef.current = hiddenModelPath
        } else {
          if (diagnosticsModel.getLanguageId() !== diagnosticSource.language) {
            monaco.editor.setModelLanguage(diagnosticsModel, diagnosticSource.language)
          }
          if (diagnosticsModel.getValue() !== diagnosticSource.content) {
            diagnosticsModel.setValue(diagnosticSource.content)
          }
        }

        const tsNamespace = getTypeScriptNamespace(monaco)

        const getWorkerFactory =
          diagnosticSource.language === 'typescript'
            ? tsNamespace?.getTypeScriptWorker
            : tsNamespace?.getJavaScriptWorker

        if (!getWorkerFactory) {
          return
        }

        try {
          const workerFactory = await getWorkerFactory()
          if (cancelled || runId !== diagnosticsRunIdRef.current) return

          const worker = await workerFactory(diagnosticsModel.uri)
          if (cancelled || runId !== diagnosticsRunIdRef.current) return

          const hiddenPath = diagnosticsModel.uri.toString()
          const [syntacticDiagnostics, semanticDiagnostics, suggestionDiagnostics] =
            await Promise.all([
              worker.getSyntacticDiagnostics(hiddenPath),
              worker.getSemanticDiagnostics(hiddenPath),
              worker.getSuggestionDiagnostics(hiddenPath),
            ])

          if (cancelled || runId !== diagnosticsRunIdRef.current) return

          const userCodeStartOffset = diagnosticsModel.getOffsetAt({
            lineNumber: diagnosticSource.userCodeStartLine,
            column: 1,
          })
          const userCodeEndOffset = userCodeStartOffset + diagnosticSource.userCodeLength
          const visibleLength = visibleModel.getValueLength()
          const diagnostics = [
            ...syntacticDiagnostics,
            ...semanticDiagnostics,
            ...suggestionDiagnostics,
          ]

          const severityMap: Record<number, number> = {
            0: monaco.MarkerSeverity.Warning,
            1: monaco.MarkerSeverity.Error,
            2: monaco.MarkerSeverity.Hint,
            3: monaco.MarkerSeverity.Info,
          }

          const markers: MonacoEditorTypes.IMarkerData[] = diagnostics.flatMap((diagnostic) => {
            const diagnosticStart = diagnostic?.start
            if (typeof diagnosticStart !== 'number') return []

            const diagnosticLength =
              typeof diagnostic?.length === 'number' ? Math.max(diagnostic.length, 1) : 1
            const diagnosticEnd = diagnosticStart + diagnosticLength
            const clampedStart = Math.max(userCodeStartOffset, diagnosticStart)
            const clampedEnd = Math.min(userCodeEndOffset, diagnosticEnd)

            if (clampedStart >= userCodeEndOffset || clampedEnd <= userCodeStartOffset) {
              return []
            }

            const visibleStartOffset = Math.max(0, clampedStart - userCodeStartOffset)
            const visibleEndOffset = Math.min(
              visibleLength,
              Math.max(visibleStartOffset + 1, clampedEnd - userCodeStartOffset)
            )
            const startPosition = visibleModel.getPositionAt(visibleStartOffset)
            const endPosition = visibleModel.getPositionAt(visibleEndOffset)

            const tags: number[] = []
            if (diagnostic?.reportsUnnecessary) {
              tags.push(monaco.MarkerTag.Unnecessary)
            }
            if (diagnostic?.reportsDeprecated) {
              tags.push(monaco.MarkerTag.Deprecated)
            }

            return [
              {
                startLineNumber: startPosition.lineNumber,
                startColumn: startPosition.column,
                endLineNumber: endPosition.lineNumber,
                endColumn: endPosition.column,
                message: flattenDiagnosticMessageText(diagnostic.messageText),
                severity: severityMap[diagnostic.category] ?? monaco.MarkerSeverity.Error,
                source: diagnostic.source ?? 'typescript',
                code:
                  diagnostic.code === undefined || diagnostic.code === null
                    ? undefined
                    : String(diagnostic.code),
                tags: tags.length > 0 ? tags : undefined,
              },
            ]
          })

          if (cancelled || runId !== diagnosticsRunIdRef.current) return

          clearModelDiagnostics(visibleModel)
          monaco.editor.setModelMarkers(visibleModel, VIRTUAL_DIAGNOSTICS_OWNER, markers)
        } catch (error) {
          if (!cancelled && runId === diagnosticsRunIdRef.current) {
            console.error('Monaco virtual diagnostics failed', error)
          }
        }
      }

      const scheduleVirtualDiagnostics = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
        timeoutId = window.setTimeout(() => {
          void runVirtualDiagnostics()
        }, 120)
      }

      const subscription = editor.onDidChangeModelContent(() => {
        scheduleVirtualDiagnostics()
      })

      scheduleVirtualDiagnostics()

      return () => {
        cancelled = true
        diagnosticsRunIdRef.current += 1
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
        subscription.dispose()
        clearModelDiagnostics(editor.getModel())
        disposeDiagnosticsModel()
      }
    }, [diagnosticSourceBuilder, editorReady, extraLibs, language, resolvedPath])

    useEffect(() => {
      return () => {
        subscriptionsRef.current.forEach((subscription) => subscription.dispose())
        subscriptionsRef.current = []
        clearModelDiagnostics(editorRef.current?.getModel())
        disposeDiagnosticsModel()

        // Dispose auto-generated models on unmount to avoid stale script files
        // piling up in Monaco's TS project and triggering duplicate identifier diagnostics.
        if (!path) {
          const monaco = monacoRef.current
          const currentPath = modelPathRef.current
          if (monaco && currentPath) {
            const model = monaco.editor.getModel(monaco.Uri.parse(currentPath))
            model?.dispose()
          }
        }
      }
    }, [path])

    useEffect(() => {
      applyDecorations()
    }, [decorations, value])

    useEffect(() => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      if (!editor || !monaco) return
      const model = editor.getModel()
      if (!model) return
      if (language) {
        monaco.editor.setModelLanguage(model, language)
      }
    }, [language, monacoInstance])

    useEffect(() => {
      updateAutoHeight()
    }, [autoHeight, value, minHeightPx, maxHeightPx])

    useEffect(() => {
      if (!containerRef.current || !editorRef.current) return
      const editor = editorRef.current
      const resizeObserver = new ResizeObserver((entries) => {
        updatePlaceholderOffset()
        const layout = editor.getLayoutInfo()
        const measuredWidth =
          entries?.[0]?.contentRect?.width ?? containerRef.current?.clientWidth
        const measuredHeight =
          entries?.[0]?.contentRect?.height ?? containerRef.current?.clientHeight
        const nextWidth =
          Number.isFinite(measuredWidth) && (measuredWidth as number) > 0
            ? (measuredWidth as number)
            : layout.width
        const nextHeight = autoHeight
          ? autoHeightPx ?? editor.getContentHeight()
          : Number.isFinite(measuredHeight) && (measuredHeight as number) > 0
            ? (measuredHeight as number)
            : layout.height
        editor.layout({ width: nextWidth, height: nextHeight })
      })
      resizeObserver.observe(containerRef.current)
      return () => resizeObserver.disconnect()
    }, [autoHeight, autoHeightPx, editorReady])

    const safePlaceholderTop = Number.isFinite(placeholderOffset.top) ? placeholderOffset.top : 8
    const safePlaceholderLeft = Number.isFinite(placeholderOffset.left) ? placeholderOffset.left : 12
    const baseOptions = useMemo<MonacoEditorTypes.IStandaloneEditorConstructionOptions>(
      () => ({
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on' as const,
        renderLineHighlight: 'none' as const,
        glyphMargin: false,
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 3,
        folding: false,
        overviewRulerBorder: false,
        automaticLayout: true,
        fontSize: 14,
        lineHeight: 21,
        readOnly: readOnly || disabled,
        domReadOnly: readOnly || disabled,
        hover: { enabled: true, sticky: true },
        parameterHints: { enabled: false },
        suggest: { showInlineDetails: true },
        suggestOnTriggerCharacters: false,
        quickSuggestions: { other: 'inline' as const, comments: true, strings: true },
        inlineSuggest: { enabled: true },
        scrollbar: {
          verticalScrollbarSize: 6,
          horizontalScrollbarSize: 6,
          useShadows: false,
          alwaysConsumeMouseWheel: false,
        },
      }),
      [readOnly, disabled]
    )
    const mergedOptions = useMemo<MonacoEditorTypes.IStandaloneEditorConstructionOptions>(() => {
      if (!options) return baseOptions
      return {
        ...baseOptions,
        ...options,
        scrollbar: {
          ...(baseOptions.scrollbar ?? {}),
          ...(options.scrollbar ?? {}),
        },
      }
    }, [baseOptions, options])

    useEffect(() => {
      if (!yText || !editorReady) return
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel()
      if (!model) return

      let cancelled = false
      let binding: any = null
      import('y-monaco').then(({ MonacoBinding }) => {
        if (cancelled || !editorRef.current) return
        const nextBinding = new MonacoBinding(
          yText,
          model,
          new Set([editor]),
          awareness ?? undefined
        )
        const originalDestroy = nextBinding.destroy.bind(nextBinding)
        let isDestroyed = false
        nextBinding.destroy = () => {
          if (isDestroyed) {
            return
          }
          isDestroyed = true
          originalDestroy()
        }

        binding = nextBinding
      })

      return () => {
        cancelled = true
        if (binding) {
          binding.destroy()
        }
      }
    }, [yText, editorReady, awareness])

    if (!monacoInstance) {
      return (
        <div
          ref={containerRef}
          className={cn('relative', className)}
          style={{ minHeight, height: resolvedHeight }}
        >
          {placeholder && !hasValue && (
            <div
              className='pointer-events-none absolute select-none text-muted-foreground/50'
              style={{ top: safePlaceholderTop, left: safePlaceholderLeft }}
            >
              {placeholder}
            </div>
          )}
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        className={cn('relative', className)}
        style={{ minHeight, height: resolvedHeight }}
      >
        {placeholder && !hasValue && (
          <div
            className='pointer-events-none absolute select-none text-muted-foreground/50'
            style={{ top: safePlaceholderTop, left: safePlaceholderLeft }}
          >
            {placeholder}
          </div>
        )}
        <MonacoReactEditor
          value={yText ? undefined : value}
          language={language}
          path={resolvedPath}
          defaultLanguage={language}
          theme={theme}
          onChange={yText ? undefined : (nextValue) => onChange?.(nextValue ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor
            monacoRef.current = monaco
            setEditorReady(true)
            defineMonacoThemes(monaco)
            monaco.editor.setTheme(theme)
            updatePlaceholderOffset()

            const model = editor.getModel()

            if (monaco) {
              configureTypeScriptDefaults(monaco)
              if (model) {
                const activePath = model.uri.toString()
                monaco.editor.getModels().forEach((candidateModel) => {
                  const candidatePath = candidateModel.uri.toString()
                  if (candidatePath === activePath) return
                  if (!candidatePath.startsWith('inmemory://model/monaco-')) return
                  if (candidateModel.isAttachedToEditor()) return
                  candidateModel.dispose()
                })
              }
            }

            if (model && language) {
              monaco.editor.setModelLanguage(model, language)
            }

            clearModelDiagnostics(model)

            subscriptionsRef.current.push(
              editor.onDidChangeCursorPosition(() => {
                if (!onCursorChange) return
                const model = editor.getModel()
                const position = editor.getPosition()
                if (!model || !position) return
                onCursorChange(model.getOffsetAt(position))
              })
            )

            subscriptionsRef.current.push(
              editor.onKeyDown((event) => {
                if (event.keyCode === monaco.KeyCode.Space) {
                  event.stopPropagation()
                  event.browserEvent.stopPropagation?.()
                  if (event.browserEvent.defaultPrevented) {
                    event.preventDefault()
                    editor.trigger('keyboard', 'type', { text: ' ' })
                  }
                }
                if (onKeyDown) onKeyDown(event.browserEvent)
              })
            )

            subscriptionsRef.current.push(
              editor.onKeyUp((event) => {
                if (onKeyUp) onKeyUp(event.browserEvent)
              })
            )

            subscriptionsRef.current.push(
              editor.onMouseDown((event) => {
                if (onClick) onClick(event.event.browserEvent)
              })
            )

            subscriptionsRef.current.push(
              editor.onDidBlurEditorText(() => {
                onBlur?.()
              })
            )

            subscriptionsRef.current.push(
              editor.onDidFocusEditorText(() => {
                onFocus?.()
              })
            )

            subscriptionsRef.current.push(
              editor.onDidContentSizeChange(() => {
                updateAutoHeight()
              })
            )

            if (yText && onChange) {
              subscriptionsRef.current.push(
                editor.onDidChangeModelContent(() => {
                  onChange(editor.getValue())
                })
              )
            }

            subscriptionsRef.current.push(
              editor.onDidLayoutChange(() => {
                updatePlaceholderOffset()
              })
            )

            updateAutoHeight()
            applyDecorations()
          }}
          options={mergedOptions}
        />
      </div>
    )
  }
)

MonacoEditor.displayName = 'MonacoEditor'
