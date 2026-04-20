import type { editor as MonacoEditorTypes, Position } from 'monaco-editor'
import type * as Y from 'yjs'

export type MonacoModule = typeof import('monaco-editor')

export type MonacoInjectedText = {
  content: string
  className?: string
  cursorStops?: 'both' | 'left' | 'right' | 'none'
  inlineClassNameAffectsLetterSpacing?: boolean
}

export type MonacoDecoration = {
  startOffset: number
  endOffset: number
  className?: string
  inlineClassNameAffectsLetterSpacing?: boolean
  before?: MonacoInjectedText
  after?: MonacoInjectedText
}

export type MonacoEditorHandle = {
  getEditor: () => MonacoEditorTypes.IStandaloneCodeEditor | null
  focus: () => void
  getCursorOffset: () => number
  setCursorOffset: (offset: number) => void
  getCursorPosition: () => Position | null
  getCursorCoords: () => { top: number; left: number; height: number } | null
  insertTextAtCursor: (text: string) => void
}

export type MonacoDiagnosticLanguage = 'javascript' | 'typescript'

export type MonacoDiagnosticSource = {
  content: string
  language: MonacoDiagnosticLanguage
  userCodeStartLine: number
  userCodeLength: number
  fileExtension?: 'js' | 'ts'
}

export type MonacoDiagnosticSourceBuilder = (
  source: string,
  context: {
    language: MonacoDiagnosticLanguage
    path: string
  }
) => MonacoDiagnosticSource | null

export type MonacoEditorProps = {
  value: string
  onChange?: (value: string) => void
  language?: string
  path?: string
  placeholder?: string
  className?: string
  height?: string | number
  minHeight?: string | number
  maxHeight?: string | number
  options?: MonacoEditorTypes.IStandaloneEditorConstructionOptions
  readOnly?: boolean
  disabled?: boolean
  decorations?: MonacoDecoration[]
  onCursorChange?: (offset: number) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onKeyUp?: (event: KeyboardEvent) => void
  onClick?: (event: MouseEvent) => void
  onBlur?: () => void
  onFocus?: () => void
  autoHeight?: boolean
  extraLibs?: ReadonlyArray<{
    content: string
    filePath?: string
  }>
  /**
   * When provided, MonacoBinding from y-monaco binds this Y.Text directly to
   * the editor model for character-level collaborative editing. The `value`
   * prop is ignored and `onChange` will not fire; all edits flow through Yjs.
   */
  yText?: Y.Text | null
  /**
   * Yjs Awareness instance for rendering remote cursor positions and
   * selections as Monaco decorations. Only used when `yText` is provided.
   */
  awareness?: import('@y/protocols/awareness').Awareness | null
  diagnosticSourceBuilder?: MonacoDiagnosticSourceBuilder
}
