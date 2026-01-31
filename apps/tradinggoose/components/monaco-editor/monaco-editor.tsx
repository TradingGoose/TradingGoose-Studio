'use client'

import { loader } from '@monaco-editor/react'
import dynamic from 'next/dynamic'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditorTypes, IDisposable } from 'monaco-editor'
import { cn } from '@/lib/utils'
import { ensureMonacoEnvironment } from '@/components/monaco-editor/monaco-editor-environment'
import { defineMonacoThemes, getIsDark } from '@/components/monaco-editor/monaco-editor-theme'
import { parsePx } from '@/components/monaco-editor/monaco-editor-utils'
import type {
  MonacoEditorHandle,
  MonacoEditorProps,
  MonacoInjectedText,
  MonacoModule,
} from '@/components/monaco-editor/monaco-editor-types'

const MonacoReactEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

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
    const markerFilteringRef = useRef(false)
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
      const tsNamespace = (monaco as MonacoModule & {
        typescript?: {
          typescriptDefaults?: {
            getCompilerOptions: () => Record<string, unknown>
            setCompilerOptions: (options: Record<string, unknown>) => void
            setDiagnosticsOptions: (options: Record<string, unknown>) => void
          }
          javascriptDefaults?: {
            getCompilerOptions: () => Record<string, unknown>
            setCompilerOptions: (options: Record<string, unknown>) => void
            setDiagnosticsOptions: (options: Record<string, unknown>) => void
          }
          JsxEmit?: { None?: unknown }
        }
      }).typescript
      return {
        tsDefaults: tsNamespace?.typescriptDefaults,
        jsDefaults: tsNamespace?.javascriptDefaults,
        jsxEmit: tsNamespace?.JsxEmit,
      }
    }

    const configureTypeScriptDefaults = (monaco: MonacoModule) => {
      const { tsDefaults, jsDefaults, jsxEmit } = getTypeScriptDefaults(monaco)
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
        })
      }
      const applyDiagnosticsOptions = (defaults?: typeof tsDefaults) => {
        if (!defaults) return
        defaults.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
          diagnosticCodesToIgnore: [1108, 8010],
        })
      }
      applyCompilerOptions(tsDefaults)
      applyCompilerOptions(jsDefaults)
      applyDiagnosticsOptions(tsDefaults)
      applyDiagnosticsOptions(jsDefaults)
    }

    const getPlaceholderRanges = (source: string) => {
      const ranges: Array<{ start: number; end: number }> = []
      const envVarRegex = /\{\{[^}\s]+\}\}/g
      const isPlaceholderStartChar = (char?: string) => !!char && /[A-Za-z_]/.test(char)
      const isInvalidPlaceholderPrefix = (char?: string) =>
        !!char && /[A-Za-z0-9_$\]\)\}]/.test(char)
      let match: RegExpExecArray | null

      while ((match = envVarRegex.exec(source)) !== null) {
        ranges.push({ start: match.index, end: match.index + match[0].length })
      }

      for (let i = 0; i < source.length; i += 1) {
        if (source[i] !== '<') continue
        const next = source[i + 1]
        if (!isPlaceholderStartChar(next)) continue
        let prevIndex = i - 1
        while (prevIndex >= 0 && /\s/.test(source[prevIndex])) {
          prevIndex -= 1
        }
        if (isInvalidPlaceholderPrefix(source[prevIndex])) continue

        let end = i + 1
        while (end < source.length) {
          const ch = source[end]
          if (ch === '>') {
            end += 1
            break
          }
          if (/\s/.test(ch)) {
            break
          }
          end += 1
        }
        if (end > i + 1) {
          ranges.push({ start: i, end })
          i = Math.max(i, end - 1)
        }
      }

      return ranges
    }

    const filterPlaceholderMarkers = () => {
      if (markerFilteringRef.current) return
      const monaco = monacoRef.current
      const editor = editorRef.current
      if (!monaco || !editor) return
      const model = editor.getModel()
      if (!model) return
      const languageId = model.getLanguageId()
      if (languageId !== 'javascript' && languageId !== 'typescript') return

      const ranges = getPlaceholderRanges(model.getValue())
      if (ranges.length === 0) return

      markerFilteringRef.current = true
      const owners = ['typescript', 'javascript']
      const markerIntersects = (start: number, end: number, markerStart: number, markerEnd: number) =>
        markerStart < end && markerEnd > start
      const isJsxPlaceholderError = (message: string) => {
        const normalized = message.toLowerCase()
        return (
          normalized.includes('jsx element') ||
          (normalized.includes('did you mean') && normalized.includes('>')) ||
          normalized.includes('&gt') ||
          normalized.includes("'</' expected") ||
          normalized.includes('expected corresponding jsx closing tag')
        )
      }

      try {
        owners.forEach((owner) => {
          const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner })
          if (markers.length === 0) return

          const filtered = markers.filter((marker) => {
            const markerStart = model.getOffsetAt({
              lineNumber: marker.startLineNumber,
              column: marker.startColumn,
            })
            const markerEnd = model.getOffsetAt({
              lineNumber: marker.endLineNumber,
              column: marker.endColumn,
            })
            if (ranges.some((range) => markerIntersects(range.start, range.end, markerStart, markerEnd))) {
              return false
            }
            if (marker.message && isJsxPlaceholderError(String(marker.message))) {
              return false
            }
            return true
          })

          if (filtered.length !== markers.length) {
            monaco.editor.setModelMarkers(model, owner, filtered)
          }
        })
      } finally {
        queueMicrotask(() => {
          markerFilteringRef.current = false
        })
      }
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
      return () => {
        subscriptionsRef.current.forEach((subscription) => subscription.dispose())
        subscriptionsRef.current = []
      }
    }, [])

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

    if (!monacoInstance) {
      return (
        <div
          ref={containerRef}
          className={cn('relative', className)}
          style={{ minHeight, height: resolvedHeight }}
        >
          {placeholder && !value && (
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
        {placeholder && !value && (
          <div
            className='pointer-events-none absolute select-none text-muted-foreground/50'
            style={{ top: safePlaceholderTop, left: safePlaceholderLeft }}
          >
            {placeholder}
          </div>
        )}
        <MonacoReactEditor
          value={value}
          language={language}
          path={resolvedPath}
          defaultLanguage={language}
          theme={theme}
          onChange={(nextValue) => onChange?.(nextValue ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor
            monacoRef.current = monaco
            setEditorReady(true)
            defineMonacoThemes(monaco)
            monaco.editor.setTheme(theme)
            updatePlaceholderOffset()

            if (monaco) {
              configureTypeScriptDefaults(monaco)
            }

            const model = editor.getModel()
            if (model && language) {
              monaco.editor.setModelLanguage(model, language)
            }

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

            subscriptionsRef.current.push(
              editor.onDidLayoutChange(() => {
                updatePlaceholderOffset()
              })
            )

            subscriptionsRef.current.push(
              monaco.editor.onDidChangeMarkers((resources) => {
                const model = editor.getModel()
                if (!model) return
                const modelUri = model.uri.toString()
                if (!resources.some((uri) => uri.toString() === modelUri)) return
                filterPlaceholderMarkers()
              })
            )

            updateAutoHeight()
            applyDecorations()
            filterPlaceholderMarkers()
          }}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            renderLineHighlight: 'none',
            glyphMargin: false,
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 3,
            folding: false,
            overviewRulerBorder: false,
            automaticLayout: true,
            fontSize: 14,
            lineHeight: 21,
            //fontFamily:
            //'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            readOnly: readOnly || disabled,
            domReadOnly: readOnly || disabled,
            hover: { enabled: true, sticky: true },
            parameterHints: { enabled: false },
            suggest: { showInlineDetails: true },
            suggestOnTriggerCharacters: false,
            quickSuggestions: { other: 'inline', comments: true, strings: true },
            inlineSuggest: { enabled: true },
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
              useShadows: false,
              alwaysConsumeMouseWheel: false,
            },
            ...options,
          }}
        />
      </div>
    )
  }
)

MonacoEditor.displayName = 'MonacoEditor'
