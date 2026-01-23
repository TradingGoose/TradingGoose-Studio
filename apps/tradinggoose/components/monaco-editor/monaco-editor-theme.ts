import type { MonacoModule } from '@/components/monaco-editor/monaco-editor-types'

let themesDefined = false

export const defineMonacoThemes = (monaco: MonacoModule) => {
  if (themesDefined) return
  themesDefined = true

  monaco.editor.defineTheme('tg-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6B7280' },
      { token: 'keyword', foreground: '7C3AED', fontStyle: 'bold' },
      { token: 'number', foreground: 'D97706' },
      { token: 'string', foreground: '047857' },
      { token: 'delimiter', foreground: '1F2937' },
      { token: 'type.identifier', foreground: '2563EB' },
      { token: 'function', foreground: '0F766E' },
      { token: 'identifier', foreground: '111827' },
    ],
    colors: {
      'editor.foreground': '#0F172A',
    },
  })

  monaco.editor.defineTheme('tg-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '94A3B8' },
      { token: 'keyword', foreground: 'C084FC', fontStyle: 'bold' },
      { token: 'number', foreground: 'FBBF24' },
      { token: 'string', foreground: '34D399' },
      { token: 'delimiter', foreground: 'E2E8F0' },
      { token: 'type.identifier', foreground: '60A5FA' },
      { token: 'function', foreground: '5EEAD4' },
      { token: 'identifier', foreground: 'F8FAFC' },
    ],
    colors: {
      'editor.foreground': '#E2E8F0',
    },
  })
}

export const getIsDark = () => {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}
