export const ensureMonacoEnvironment = () => {
  const globalScope = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorkerUrl: (moduleId: string, label: string) => string
    }
  }

  if (globalScope.MonacoEnvironment) return

  const monacoWorkerBasePath = '/monaco-editor/esm/vs'

  globalScope.MonacoEnvironment = {
    getWorkerUrl: (_moduleId, label) => {
      if (label === 'json') {
        return `${monacoWorkerBasePath}/language/json/json.worker.js`
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return `${monacoWorkerBasePath}/language/css/css.worker.js`
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return `${monacoWorkerBasePath}/language/html/html.worker.js`
      }
      if (label === 'typescript' || label === 'javascript') {
        return `${monacoWorkerBasePath}/language/typescript/ts.worker.js`
      }
      return `${monacoWorkerBasePath}/editor/editor.worker.js`
    },
  }
}
