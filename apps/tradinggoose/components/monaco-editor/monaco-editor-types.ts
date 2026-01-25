import type { editor as MonacoEditorTypes, Position } from 'monaco-editor'

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
  extraLibs?: Array<{
    content: string
    filePath?: string
  }>
}
