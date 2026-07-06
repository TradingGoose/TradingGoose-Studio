import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {
  createEntryDiscoveryContext,
  discoverAllModeEntries,
  type EntryDiscoveryContext,
  type EntryExportName,
  isIgnoredProjectPath,
  isPathInsideDirectory,
  isRoutePathPrefix,
  resolveAppRoutePathForFile,
  resolveOwningRoutePathForFile,
  resolveRouteEntries,
  SOURCE_EXTENSIONS,
  toRelativeProjectPath,
} from './entries'
import {
  deriveComponentKeySegment,
  deriveRouteNamespace,
  getRouteOwnedNamespaces,
} from './ownership'

const HARD_CODED_PROP_NAMES = new Set([
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'label',
  'description',
  'helperText',
  'tooltip',
])
const ARRAY_CONSUMER_METHOD_NAMES = new Set([
  'at',
  'concat',
  'entries',
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flat',
  'flatMap',
  'forEach',
  'includes',
  'indexOf',
  'join',
  'keys',
  'lastIndexOf',
  'map',
  'reduce',
  'reduceRight',
  'slice',
  'some',
  'toReversed',
  'toSorted',
  'toSpliced',
  'values',
  'with',
])
const ARRAY_RUNTIME_CALLBACK_METHOD_NAMES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'toSorted',
])
const RUNTIME_CALLBACK_HOOK_NAMES = new Set([
  'useEffect',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
])
const RUNTIME_CALLBACK_FUNCTION_NAMES = new Set([
  'queueMicrotask',
  'requestAnimationFrame',
  'startTransition',
  'setInterval',
  'setTimeout',
])
const ROOT_HINT_NAME = /(^copy$|Copy$|^messages$|Messages$|^widgetsCopy$|^monitorCopy$)/i
const METADATA_PROP_NAMES = new Set(['title', 'description', 'alt'])

type Descriptor =
  | { kind: 'root'; path: string[] }
  | { kind: 'translator'; namespace: string[] }
  | { kind: 'object'; properties: Record<string, Descriptor> }
  | { kind: 'callable'; filePath: string; closureScope: Scope; targetNode: NamedFunctionNode }

type NamedFunctionNode = ts.FunctionLikeDeclaration & { name?: ts.PropertyName | ts.BindingName }

type ImportBinding = {
  importedName: string
  localName: string
  resolvedFilePath: string | null
}

type ReExportBinding = {
  importedName: string
  exportedName: string
  resolvedFilePath: string | null
}

type LocalExportBinding = {
  localName: string
  exportedName: string
}

type TypeImportBinding = {
  importedName: string
  localName: string
  resolvedFilePath: string | null
}

type TypeExportBinding = {
  localName: string
  exportedName: string
}

type TypeReExportBinding = {
  importedName: string
  exportedName: string
  resolvedFilePath: string | null
}

type TypeDeclarationNode = ts.TypeAliasDeclaration | ts.InterfaceDeclaration

type RequestedExports = 'all' | Set<string>

type RuntimeImportEdge = {
  resolvedFilePath: string
  requestedExports: RequestedExports
}

type PendingReachability = {
  filePath: string
  requestedExports: RequestedExports
}

type ProjectFile = {
  filePath: string
  relativePath: string
  sourceFile: ts.SourceFile
  importBindings: Map<string, ImportBinding>
  typeImportBindings: Map<string, TypeImportBinding>
  runtimeImportEdges: RuntimeImportEdge[]
  localExportBindings: LocalExportBinding[]
  reExportBindings: ReExportBinding[]
  typeReExportBindings: TypeReExportBinding[]
  exportAllPaths: string[]
  exportedValueNames: Set<string>
  hasDefaultExport: boolean
  localTypeDeclarations: Map<string, TypeDeclarationNode>
  localTypeExportBindings: TypeExportBinding[]
  typeRoots: Map<string, Descriptor>
  localFunctions: Map<string, NamedFunctionNode>
  exportedFunctions: Set<string>
  defaultExportFunction: NamedFunctionNode | null
  defaultExportBindingName: string | null
}

type TranslatorHint = {
  name: string
  namespace: string[]
}

type RootHint = {
  name: string
  path: string[]
}

type ScopeKind = 'root' | 'function' | 'block'

type Scope = {
  kind: ScopeKind
  parent: Scope | null
  hoistTarget: Scope | null
  bindings: Map<string, Descriptor>
  translatorHints: TranslatorHint[]
  rootHints: RootHint[]
  currentFunction: ts.FunctionLikeDeclaration | null
  inMetadata: boolean
}

type FunctionSemantics = Map<string, Descriptor>
type FileSemantics = Map<string, Descriptor>
type ArgumentDescriptor = {
  index: number
  descriptor: Descriptor
}

type FileAnalysis = {
  file: ProjectFile
  importedCallableDescriptors: Map<string, Descriptor>
  importedSemantics: Map<string, Descriptor>
  localSemantics: Map<string, Descriptor>
}

type ExportedFunctionTarget = {
  targetFile: ProjectFile
  targetNode: NamedFunctionNode
}

type CallableTarget = {
  activeRoutePath: string | null
  closureScope: Scope | null
  targetFile: ProjectFile
  targetNode: NamedFunctionNode
  targetImportedSemantics: Map<string, Descriptor>
}

type ScanState = {
  coverage: CoverageRecord[]
  hardcodedCandidates: HardcodedCandidate[]
}

type ScanContext = {
  entryDiscoveryContext: EntryDiscoveryContext
  projectRoot: string
  projectFiles: Map<string, ProjectFile>
  semanticsByFile: Map<string, Map<string, Descriptor>>
  analysisByFile: Map<string, FileAnalysis>
  routePath: string | null
  invocationCache: Set<string>
}

type EntryInvocation = {
  activeRoutePath: string | null
  exportName: EntryExportName
}

type ScanFileOptions = {
  entryInvocations: EntryInvocation[]
  rootScanRoutePaths: Array<string | null>
}

export type CoverageRecord = {
  filePath: string
  line: number
  column: number
  path: string[]
  pathKey: string
  mode: 'exact' | 'subtree'
  source: 'copy-access' | 'translation'
  subtreeReason?: 'array-root' | 'dynamic-root'
}

export type HardcodedCandidate = {
  filePath: string
  line: number
  column: number
  text: string
  kind: 'jsx-text' | 'jsx-attribute' | 'metadata'
  namespace: string
  namespaceSource: 'static' | 'ownership' | 'fallback'
  relativeKeyParts: string[]
  attributeName?: string
  metadata: boolean
}

export type ScanMode = 'route' | 'all'

export type CatalogScanResult = {
  mode: ScanMode
  routePath: string | null
  ownedNamespaces: string[]
  scannedFiles: string[]
  coverage: CoverageRecord[]
  hardcodedCandidates: HardcodedCandidate[]
}

export type CatalogProjectContext = {
  entryDiscoveryContext: EntryDiscoveryContext
  projectFiles: Map<string, ProjectFile>
  projectRoot: string
}

type ContextScanOptions = { mode: 'all' } | { mode: 'route'; routePath: string }

type ScanOptions =
  | ({ mode: 'all' } & { projectRoot: string })
  | { mode: 'route'; projectRoot: string; routePath: string }

function rootDescriptor(pathParts: string[]): Descriptor {
  return { kind: 'root', path: [...pathParts] }
}

function translatorDescriptor(namespaceParts: string[]): Descriptor {
  return { kind: 'translator', namespace: [...namespaceParts] }
}

function objectDescriptor(properties: Record<string, Descriptor>): Descriptor {
  return { kind: 'object', properties: { ...properties } }
}

function callableDescriptor(
  filePath: string,
  targetNode: NamedFunctionNode,
  closureScope: Scope
): Descriptor {
  return { kind: 'callable', filePath, closureScope, targetNode }
}

function cloneRequestedExports(requestedExports: RequestedExports): RequestedExports {
  return requestedExports === 'all' ? 'all' : new Set(requestedExports)
}

function requestedExportsCover(
  current: RequestedExports | undefined,
  incoming: RequestedExports
): boolean {
  if (!current) {
    return false
  }

  if (current === 'all') {
    return true
  }

  if (incoming === 'all') {
    return false
  }

  for (const name of incoming) {
    if (!current.has(name)) {
      return false
    }
  }

  return true
}

function mergeRequestedExports(
  current: RequestedExports | undefined,
  incoming: RequestedExports
): RequestedExports {
  if (!current) {
    return cloneRequestedExports(incoming)
  }

  if (current === 'all' || incoming === 'all') {
    return 'all'
  }

  const merged = new Set(current)
  for (const name of incoming) {
    merged.add(name)
  }
  return merged
}

function requestedExportsForName(name: string): RequestedExports {
  return new Set([name])
}

function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text]
  }

  const bindingNames: string[] = []
  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) {
      continue
    }
    bindingNames.push(...collectBindingNames(element.name))
  }
  return bindingNames
}

function cloneDescriptor(descriptor: Descriptor): Descriptor {
  if (descriptor.kind === 'root') {
    return rootDescriptor(descriptor.path)
  }
  if (descriptor.kind === 'translator') {
    return translatorDescriptor(descriptor.namespace)
  }
  if (descriptor.kind === 'callable') {
    return callableDescriptor(descriptor.filePath, descriptor.targetNode, descriptor.closureScope)
  }
  return objectDescriptor(
    Object.fromEntries(
      Object.entries(descriptor.properties).map(([key, value]) => [key, cloneDescriptor(value)])
    )
  )
}

function sameDescriptor(left: Descriptor | null, right: Descriptor | null): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return left === right
  }

  if (left.kind === 'root' && right.kind === 'root') {
    return left.path.join('.') === right.path.join('.')
  }

  if (left.kind === 'translator' && right.kind === 'translator') {
    return left.namespace.join('.') === right.namespace.join('.')
  }

  if (left.kind === 'callable' && right.kind === 'callable') {
    return descriptorToPathKey(left) === descriptorToPathKey(right)
  }

  if (left.kind === 'object' && right.kind === 'object') {
    const leftKeys = Object.keys(left.properties)
    const rightKeys = Object.keys(right.properties)
    if (leftKeys.length !== rightKeys.length) {
      return false
    }
    return leftKeys.every((key) =>
      sameDescriptor(left.properties[key] ?? null, right.properties[key] ?? null)
    )
  }

  return false
}

function descriptorToPathKey(descriptor: Descriptor): string {
  if (descriptor.kind === 'root') {
    return descriptor.path.join('.')
  }
  if (descriptor.kind === 'translator') {
    return descriptor.namespace.join('.')
  }
  if (descriptor.kind === 'callable') {
    return `callable:${descriptor.filePath}:${descriptor.targetNode.getStart(
      descriptor.targetNode.getSourceFile()
    )}`
  }
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(descriptor.properties)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, descriptorToPathKey(value)])
    )
  )
}

function descriptorMapKey(descriptors: Map<string, Descriptor> | undefined) {
  if (!descriptors) {
    return ''
  }

  return [...descriptors.entries()]
    .map(([name, descriptor]) => `${name}:${descriptorToPathKey(descriptor)}`)
    .sort()
    .join('|')
}

function getScopeBindingSignature(scope: Scope | null) {
  const entries: string[] = []
  const seenNames = new Set<string>()
  let current: Scope | null = scope

  while (current) {
    for (const [name, descriptor] of current.bindings.entries()) {
      if (seenNames.has(name)) {
        continue
      }

      seenNames.add(name)
      entries.push(`${name}:${descriptorToPathKey(descriptor)}`)
    }

    current = current.parent
  }

  return entries.sort().join('|')
}

function descriptorMapsEqual(
  left: Map<string, Descriptor> | undefined,
  right: Map<string, Descriptor> | undefined
) {
  return descriptorMapKey(left) === descriptorMapKey(right)
}

function readPropertyDescriptor(descriptor: Descriptor, propertyName: string): Descriptor | null {
  if (descriptor.kind === 'root') {
    return rootDescriptor([...descriptor.path, propertyName])
  }
  if (descriptor.kind === 'object') {
    return descriptor.properties[propertyName]
      ? cloneDescriptor(descriptor.properties[propertyName]!)
      : null
  }
  return null
}

function getLiteralPropertyName(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) {
    return null
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  if (ts.isComputedPropertyName(name)) {
    return getStaticPropertyKey(name.expression)
  }

  return null
}

function getStaticTextValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return null
}

function getStaticPropertyKey(node: ts.Expression): string | null {
  if (ts.isNumericLiteral(node)) {
    return node.text
  }

  return getStaticTextValue(node)
}

function getTypeLiteralPropertyKey(node: ts.TypeNode): string | null {
  if (!ts.isLiteralTypeNode(node)) {
    return null
  }

  if (ts.isStringLiteral(node.literal) || ts.isNumericLiteral(node.literal)) {
    return node.literal.text
  }

  return null
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression)
  }
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return unwrapExpression(node.expression)
  }
  if (ts.isSatisfiesExpression(node)) {
    return unwrapExpression(node.expression)
  }
  if (ts.isAwaitExpression(node)) {
    return unwrapExpression(node.expression)
  }
  return node
}

function isSourceFilePath(filePath: string) {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension))
}

function resolveImportPath(projectRoot: string, importerFilePath: string, specifier: string) {
  let basePath: string | null = null
  if (specifier.startsWith('@/')) {
    basePath = path.join(projectRoot, specifier.slice(2))
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    basePath = path.resolve(path.dirname(importerFilePath), specifier)
  }

  if (!basePath) {
    return null
  }

  const candidates = [basePath, ...SOURCE_EXTENSIONS.map((extension) => `${basePath}${extension}`)]
  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(path.join(basePath, `index${extension}`))
  }

  for (const candidate of candidates) {
    if (!candidate.startsWith(projectRoot)) {
      continue
    }
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      if (!isSourceFilePath(candidate)) {
        return null
      }
      const relativePath = toRelativeProjectPath(projectRoot, candidate)
      if (isIgnoredProjectPath(relativePath)) {
        return null
      }
      return candidate
    }
  }

  return null
}

function getScriptKind(filePath: string) {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function extractCallableInitializer(expression: ts.Expression): NamedFunctionNode | null {
  const node = unwrapExpression(expression)
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node
  }

  if (!ts.isCallExpression(node) && !ts.isCallChain(node)) {
    return null
  }

  const callee = unwrapExpression(node.expression)
  let calleeName: string | null = null
  if (ts.isIdentifier(callee)) {
    calleeName = callee.text
  } else if (ts.isPropertyAccessExpression(callee) || ts.isPropertyAccessChain(callee)) {
    calleeName = callee.name.text
  } else if (
    (ts.isElementAccessExpression(callee) || ts.isElementAccessChain(callee)) &&
    callee.argumentExpression
  ) {
    calleeName = getStaticPropertyKey(unwrapExpression(callee.argumentExpression))
  }

  if (calleeName !== 'useCallback') {
    return null
  }

  const callback = node.arguments[0] ? unwrapExpression(node.arguments[0]!) : null
  if (!callback) {
    return null
  }

  return ts.isArrowFunction(callback) || ts.isFunctionExpression(callback) ? callback : null
}

function collectProjectFile(projectRoot: string, filePath: string): ProjectFile {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  )
  const importBindings = new Map<string, ImportBinding>()
  const typeImportBindings = new Map<string, TypeImportBinding>()
  const runtimeImportEdges = new Map<string, RequestedExports>()
  const localExportBindings: LocalExportBinding[] = []
  const reExportBindings: ReExportBinding[] = []
  const typeReExportBindings: TypeReExportBinding[] = []
  const exportAllPaths = new Set<string>()
  const exportedValueNames = new Set<string>()
  const localTypeDeclarations = new Map<string, TypeDeclarationNode>()
  const localTypeExportBindings: TypeExportBinding[] = []
  const localFunctions = new Map<string, NamedFunctionNode>()
  const exportedFunctions = new Set<string>()
  let defaultExportFunction: NamedFunctionNode | null = null
  let defaultExportBindingName: string | null = null
  let hasDefaultExport = false

  const hasModifier = (node: { modifiers?: ts.NodeArray<ts.ModifierLike> }, kind: ts.SyntaxKind) =>
    Boolean(node.modifiers?.some((modifier) => modifier.kind === kind))

  const addRuntimeImportEdge = (
    resolvedFilePath: string | null,
    requestedExports: RequestedExports
  ) => {
    if (!resolvedFilePath) {
      return
    }

    runtimeImportEdges.set(
      resolvedFilePath,
      mergeRequestedExports(runtimeImportEdges.get(resolvedFilePath), requestedExports)
    )
  }

  const registerTypeImportBinding = (
    localName: string,
    importedName: string,
    resolvedFilePath: string | null
  ) => {
    typeImportBindings.set(localName, {
      importedName,
      localName,
      resolvedFilePath,
    })
  }

  const registerLocalTypeExportBinding = (localName: string, exportedName: string) => {
    localTypeExportBindings.push({ localName, exportedName })
  }

  const registerExportedValueName = (name: string | null) => {
    if (!name) {
      return
    }

    if (name === 'default') {
      hasDefaultExport = true
      return
    }

    exportedValueNames.add(name)
  }

  const registerFunction = (
    name: string | null,
    node: NamedFunctionNode,
    namedExported: boolean
  ) => {
    if (!name) {
      return
    }

    localFunctions.set(name, node)
    if (namedExported) {
      exportedFunctions.add(name)
      registerExportedValueName(name)
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const importClause = node.importClause
      const resolvedFilePath = resolveImportPath(projectRoot, filePath, node.moduleSpecifier.text)

      if (!importClause) {
        addRuntimeImportEdge(resolvedFilePath, 'all')
        ts.forEachChild(node, visit)
        return
      }

      if (importClause.isTypeOnly) {
        if (importClause.name) {
          registerTypeImportBinding(importClause.name.text, 'default', resolvedFilePath)
        }

        if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
          for (const binding of importClause.namedBindings.elements) {
            const importedName = binding.propertyName?.text ?? binding.name.text
            registerTypeImportBinding(binding.name.text, importedName, resolvedFilePath)
          }
        }

        ts.forEachChild(node, visit)
        return
      }

      if (importClause.name) {
        addRuntimeImportEdge(resolvedFilePath, requestedExportsForName('default'))
        importBindings.set(importClause.name.text, {
          importedName: 'default',
          localName: importClause.name.text,
          resolvedFilePath,
        })
      }

      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          addRuntimeImportEdge(resolvedFilePath, 'all')
        } else {
          for (const binding of importClause.namedBindings.elements) {
            if (binding.isTypeOnly) {
              const importedName = binding.propertyName?.text ?? binding.name.text
              registerTypeImportBinding(binding.name.text, importedName, resolvedFilePath)
              continue
            }
            const importedName = binding.propertyName?.text ?? binding.name.text
            addRuntimeImportEdge(resolvedFilePath, requestedExportsForName(importedName))
            importBindings.set(binding.name.text, {
              importedName,
              localName: binding.name.text,
              resolvedFilePath,
            })
          }
        }
      }
    }

    if (ts.isExportDeclaration(node)) {
      if (!node.moduleSpecifier) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            const localName = element.propertyName?.text ?? element.name.text

            if (node.isTypeOnly || element.isTypeOnly) {
              registerLocalTypeExportBinding(localName, element.name.text)
              continue
            }
            registerExportedValueName(element.name.text)
            localExportBindings.push({
              localName,
              exportedName: element.name.text,
            })
          }
        }
        ts.forEachChild(node, visit)
        return
      }

      if (!ts.isStringLiteral(node.moduleSpecifier)) {
        ts.forEachChild(node, visit)
        return
      }

      const resolvedFilePath = resolveImportPath(projectRoot, filePath, node.moduleSpecifier.text)

      if (!node.exportClause) {
        if (!node.isTypeOnly && resolvedFilePath) {
          exportAllPaths.add(resolvedFilePath)
        }
        ts.forEachChild(node, visit)
        return
      }

      if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const importedName = element.propertyName?.text ?? element.name.text

          if (node.isTypeOnly || element.isTypeOnly) {
            typeReExportBindings.push({
              importedName,
              exportedName: element.name.text,
              resolvedFilePath,
            })
            continue
          }

          registerExportedValueName(element.name.text)
          reExportBindings.push({
            importedName,
            exportedName: element.name.text,
            resolvedFilePath,
          })
        }
      }
    }

    if (ts.isFunctionDeclaration(node)) {
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword)
      const defaultExported = hasModifier(node, ts.SyntaxKind.DefaultKeyword)
      const namedExported = exported && !defaultExported

      registerFunction(node.name?.text ?? null, node, namedExported)

      if (defaultExported) {
        hasDefaultExport = true
        defaultExportFunction = node
      }
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword)
      for (const declaration of node.declarationList.declarations) {
        if (exported) {
          for (const bindingName of collectBindingNames(declaration.name)) {
            registerExportedValueName(bindingName)
          }
        }

        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          const functionTarget = extractCallableInitializer(declaration.initializer)
          if (functionTarget) {
            registerFunction(declaration.name.text, functionTarget, exported)
          }
        }
      }
    }

    if (ts.isClassDeclaration(node)) {
      const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword)
      const defaultExported = hasModifier(node, ts.SyntaxKind.DefaultKeyword)
      if (exported && !defaultExported) {
        registerExportedValueName(node.name?.text ?? null)
      }
      if (defaultExported) {
        hasDefaultExport = true
      }
    }

    if (ts.isEnumDeclaration(node) && hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      registerExportedValueName(node.name.text)
    }

    if (ts.isTypeAliasDeclaration(node)) {
      localTypeDeclarations.set(node.name.text, node)

      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
        const exportedName = hasModifier(node, ts.SyntaxKind.DefaultKeyword)
          ? 'default'
          : node.name.text
        registerLocalTypeExportBinding(node.name.text, exportedName)
      }
    }

    if (ts.isInterfaceDeclaration(node)) {
      localTypeDeclarations.set(node.name.text, node)

      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
        const exportedName = hasModifier(node, ts.SyntaxKind.DefaultKeyword)
          ? 'default'
          : node.name.text
        registerLocalTypeExportBinding(node.name.text, exportedName)
      }
    }

    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      hasDefaultExport = true
      const functionTarget = extractCallableInitializer(node.expression)
      if (functionTarget) {
        defaultExportFunction = functionTarget
      } else if (ts.isIdentifier(node.expression)) {
        defaultExportBindingName = node.expression.text
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return {
    filePath,
    relativePath: toRelativeProjectPath(projectRoot, filePath),
    sourceFile,
    importBindings,
    typeImportBindings,
    runtimeImportEdges: [...runtimeImportEdges.entries()].map(
      ([resolvedFilePath, requestedExports]) => ({
        resolvedFilePath,
        requestedExports: cloneRequestedExports(requestedExports),
      })
    ),
    localExportBindings,
    reExportBindings,
    typeReExportBindings,
    exportAllPaths: [...exportAllPaths],
    exportedValueNames,
    hasDefaultExport,
    localTypeDeclarations,
    localTypeExportBindings,
    typeRoots: new Map(),
    localFunctions,
    exportedFunctions,
    defaultExportFunction,
    defaultExportBindingName,
  }
}

function getProjectFile(context: CatalogProjectContext, filePath: string) {
  const cached = context.projectFiles.get(filePath)
  if (cached) {
    return cached
  }

  if (!filePath.startsWith(context.projectRoot) || !isSourceFilePath(filePath)) {
    return null
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null
  }

  const relativePath = toRelativeProjectPath(context.projectRoot, filePath)
  if (isIgnoredProjectPath(relativePath)) {
    return null
  }

  const projectFile = collectProjectFile(context.projectRoot, filePath)
  context.projectFiles.set(filePath, projectFile)
  return projectFile
}

function createBuiltinTypeRoots() {
  return new Map<string, Descriptor>([
    ['Messages', rootDescriptor([])],
    ['PublicCopy', rootDescriptor([])],
  ])
}

function resolveNamedTypeDescriptor(
  nameNode: ts.EntityName | ts.Expression,
  availableTypes: Map<string, Descriptor>
) {
  if (!ts.isIdentifier(nameNode)) {
    return null
  }

  const descriptor = availableTypes.get(nameNode.text)
  return descriptor ? cloneDescriptor(descriptor) : null
}

function resolveStructuralTypeDescriptor(
  node: ts.TypeNode | TypeDeclarationNode | ts.ExpressionWithTypeArguments | undefined,
  availableTypes: Map<string, Descriptor>
): Descriptor | null {
  if (!node) {
    return null
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return resolveStructuralTypeDescriptor(node.type, availableTypes)
  }

  if (ts.isInterfaceDeclaration(node)) {
    const properties: Record<string, Descriptor> = {}
    let resolvedAny = false

    for (const heritageClause of node.heritageClauses ?? []) {
      if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue
      }

      for (const typeNode of heritageClause.types) {
        const baseDescriptor = resolveStructuralTypeDescriptor(typeNode, availableTypes)
        if (baseDescriptor?.kind !== 'object') {
          continue
        }

        resolvedAny = true
        for (const [propertyName, propertyDescriptor] of Object.entries(
          baseDescriptor.properties
        )) {
          properties[propertyName] = cloneDescriptor(propertyDescriptor)
        }
      }
    }

    for (const member of node.members) {
      if (
        !ts.isPropertySignature(member) ||
        !member.type ||
        ts.isComputedPropertyName(member.name)
      ) {
        continue
      }

      const propertyName = getLiteralPropertyName(member.name)
      if (!propertyName) {
        continue
      }

      const propertyDescriptor = resolveStructuralTypeDescriptor(member.type, availableTypes)
      if (!propertyDescriptor) {
        continue
      }

      properties[propertyName] = propertyDescriptor
      resolvedAny = true
    }

    return resolvedAny ? objectDescriptor(properties) : null
  }

  if (ts.isExpressionWithTypeArguments(node)) {
    return resolveNamedTypeDescriptor(node.expression, availableTypes)
  }

  if (ts.isTypeReferenceNode(node)) {
    return resolveNamedTypeDescriptor(node.typeName, availableTypes)
  }

  if (ts.isIndexedAccessTypeNode(node)) {
    const objectTypeDescriptor = resolveStructuralTypeDescriptor(node.objectType, availableTypes)
    const indexType = node.indexType
    if (
      !objectTypeDescriptor ||
      !ts.isLiteralTypeNode(indexType) ||
      !ts.isStringLiteral(indexType.literal)
    ) {
      return null
    }
    return readPropertyDescriptor(objectTypeDescriptor, indexType.literal.text)
  }

  if (ts.isTypeLiteralNode(node)) {
    const properties: Record<string, Descriptor> = {}
    let resolvedAny = false

    for (const member of node.members) {
      if (
        !ts.isPropertySignature(member) ||
        !member.type ||
        ts.isComputedPropertyName(member.name)
      ) {
        continue
      }

      const propertyName = getLiteralPropertyName(member.name)
      if (!propertyName) {
        continue
      }

      const propertyDescriptor = resolveStructuralTypeDescriptor(member.type, availableTypes)
      if (!propertyDescriptor) {
        continue
      }

      properties[propertyName] = propertyDescriptor
      resolvedAny = true
    }

    return resolvedAny ? objectDescriptor(properties) : null
  }

  return null
}

function buildTypeRootsForFile(
  file: ProjectFile,
  exportedTypeDescriptorsByFile: Map<string, Map<string, Descriptor>>
) {
  const typeRoots = createBuiltinTypeRoots()

  for (const binding of file.typeImportBindings.values()) {
    if (!binding.resolvedFilePath) {
      continue
    }

    const exportedTypes = exportedTypeDescriptorsByFile.get(binding.resolvedFilePath)
    const descriptor = exportedTypes?.get(binding.importedName)
    if (descriptor) {
      typeRoots.set(binding.localName, cloneDescriptor(descriptor))
    }
  }

  let changed = true
  while (changed) {
    changed = false

    for (const [name, declaration] of file.localTypeDeclarations.entries()) {
      const descriptor = resolveStructuralTypeDescriptor(declaration, typeRoots)
      if (!descriptor) {
        continue
      }

      const existing = typeRoots.get(name) ?? null
      if (!sameDescriptor(existing, descriptor)) {
        typeRoots.set(name, cloneDescriptor(descriptor))
        changed = true
      }
    }
  }

  return typeRoots
}

function buildExportedTypeDescriptorsForFile(
  file: ProjectFile,
  typeRoots: Map<string, Descriptor>,
  exportedTypeDescriptorsByFile: Map<string, Map<string, Descriptor>>
) {
  const exportedTypes = new Map<string, Descriptor>()

  for (const binding of file.localTypeExportBindings) {
    const descriptor = typeRoots.get(binding.localName)
    if (!descriptor) {
      continue
    }

    exportedTypes.set(binding.exportedName, cloneDescriptor(descriptor))
  }

  for (const binding of file.typeReExportBindings) {
    if (!binding.resolvedFilePath) {
      continue
    }

    const sourceTypes = exportedTypeDescriptorsByFile.get(binding.resolvedFilePath)
    const descriptor = sourceTypes?.get(binding.importedName)
    if (descriptor) {
      exportedTypes.set(binding.exportedName, cloneDescriptor(descriptor))
    }
  }

  return exportedTypes
}

function populateProjectFileTypeRoots(projectFiles: Map<string, ProjectFile>) {
  const typeRootsByFile = new Map<string, Map<string, Descriptor>>()
  const exportedTypeDescriptorsByFile = new Map<string, Map<string, Descriptor>>()

  let changed = true
  while (changed) {
    changed = false

    for (const [filePath, file] of projectFiles.entries()) {
      const nextTypeRoots = buildTypeRootsForFile(file, exportedTypeDescriptorsByFile)
      if (!descriptorMapsEqual(typeRootsByFile.get(filePath), nextTypeRoots)) {
        typeRootsByFile.set(filePath, nextTypeRoots)
        changed = true
      }

      const nextExportedTypes = buildExportedTypeDescriptorsForFile(
        file,
        nextTypeRoots,
        exportedTypeDescriptorsByFile
      )
      if (!descriptorMapsEqual(exportedTypeDescriptorsByFile.get(filePath), nextExportedTypes)) {
        exportedTypeDescriptorsByFile.set(filePath, nextExportedTypes)
        changed = true
      }
    }
  }

  for (const [filePath, file] of projectFiles.entries()) {
    file.typeRoots = typeRootsByFile.get(filePath) ?? createBuiltinTypeRoots()
  }
}

function inferFileSemantics(
  file: ProjectFile,
  importedSemantics: Map<string, Descriptor>,
  importedCallableDescriptors: Map<string, Descriptor>
) {
  const semantics = new Map<string, Descriptor>()

  let changed = true
  while (changed) {
    changed = false
    for (const [name, node] of file.localFunctions.entries()) {
      const descriptor = inferFunctionDescriptor(
        node,
        file,
        semantics,
        importedSemantics,
        importedCallableDescriptors
      )
      if (!descriptor) {
        continue
      }
      const existing = semantics.get(name) ?? null
      if (!sameDescriptor(existing, descriptor)) {
        semantics.set(name, descriptor)
        changed = true
      }
    }
  }

  return semantics
}

function inferFunctionDescriptor(
  node: NamedFunctionNode,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  importedCallableDescriptors: Map<string, Descriptor>
) {
  const scope = createFunctionScope(createRootScope(), node)
  bindFunctionParameters(scope, node, file, localSemantics, importedSemantics)

  if (!node.body) {
    return null
  }

  if (!ts.isBlock(node.body)) {
    return resolveExpressionDescriptor(
      node.body,
      file,
      scope,
      localSemantics,
      importedSemantics,
      importedCallableDescriptors
    )
  }

  const descriptors: Descriptor[] = []

  const visit = (currentNode: ts.Node) => {
    if (currentNode !== node.body && isFunctionLike(currentNode)) {
      return
    }

    if (ts.isReturnStatement(currentNode) && currentNode.expression) {
      const descriptor = resolveExpressionDescriptor(
        currentNode.expression,
        file,
        scope,
        localSemantics,
        importedSemantics,
        importedCallableDescriptors
      )
      if (descriptor) {
        descriptors.push(descriptor)
      }
    }

    ts.forEachChild(currentNode, visit)
  }

  visit(node.body)

  if (descriptors.length === 0) {
    return null
  }

  const [firstDescriptor] = descriptors
  if (descriptors.every((descriptor) => sameDescriptor(firstDescriptor, descriptor))) {
    return cloneDescriptor(firstDescriptor!)
  }

  return null
}

function createRootScope(): Scope {
  const scope: Scope = {
    kind: 'root',
    parent: null,
    hoistTarget: null,
    bindings: new Map(),
    translatorHints: [],
    rootHints: [],
    currentFunction: null,
    inMetadata: false,
  }
  scope.hoistTarget = scope
  return scope
}

function dedupeNullableStrings(values: Array<string | null>) {
  const seen = new Set<string>()
  const deduped: Array<string | null> = []

  for (const value of values) {
    const key = value ?? '__null__'
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(value)
  }

  return deduped
}

function createFunctionScope(parent: Scope, node: ts.FunctionLikeDeclaration): Scope {
  const scope: Scope = {
    kind: 'function',
    parent,
    hoistTarget: null,
    bindings: new Map(),
    translatorHints: [],
    rootHints: [],
    currentFunction: node,
    inMetadata:
      parent.inMetadata ||
      (ts.isFunctionDeclaration(node) && node.name?.text === 'generateMetadata'),
  }
  scope.hoistTarget = scope
  return scope
}

function createBlockScope(parent: Scope, options?: { inMetadata?: boolean }): Scope {
  return {
    kind: 'block',
    parent,
    hoistTarget: parent.hoistTarget,
    bindings: new Map(),
    translatorHints: [],
    rootHints: [],
    currentFunction: parent.currentFunction,
    inMetadata: options?.inMetadata ?? parent.inMetadata,
  }
}

function lookupBinding(scope: Scope, name: string): Descriptor | null {
  let current: Scope | null = scope
  while (current) {
    const descriptor = current.bindings.get(name)
    if (descriptor) {
      return cloneDescriptor(descriptor)
    }
    current = current.parent
  }
  return null
}

function findTranslatorHint(
  scope: Scope,
  predicate: (hint: TranslatorHint) => boolean = () => true
): TranslatorHint | null {
  let current: Scope | null = scope
  while (current) {
    for (let index = current.translatorHints.length - 1; index >= 0; index -= 1) {
      const hint = current.translatorHints[index]!
      if (predicate(hint)) {
        return {
          name: hint.name,
          namespace: [...hint.namespace],
        }
      }
    }
    current = current.parent
  }
  return null
}

function findRootHint(
  scope: Scope,
  predicate: (hint: RootHint) => boolean = () => true
): RootHint | null {
  let current: Scope | null = scope
  while (current) {
    for (let index = current.rootHints.length - 1; index >= 0; index -= 1) {
      const hint = current.rootHints[index]!
      if (predicate(hint)) {
        return {
          name: hint.name,
          path: [...hint.path],
        }
      }
    }
    current = current.parent
  }
  return null
}

function isBlockScopedDeclarationList(node: ts.VariableDeclarationList) {
  return (node.flags & ts.NodeFlags.BlockScoped) !== 0
}

function bindVariableDeclaration(
  scope: Scope,
  node: ts.VariableDeclaration,
  descriptor: Descriptor
) {
  const declarationList = ts.isVariableDeclarationList(node.parent) ? node.parent : null
  const targetScope =
    declarationList && !isBlockScopedDeclarationList(declarationList)
      ? (scope.hoistTarget ?? scope)
      : scope
  bindPattern(targetScope, node.name, descriptor)
}

function bindFunctionParameters(
  scope: Scope,
  node: ts.FunctionLikeDeclaration,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  argumentDescriptors: ArgumentDescriptor[] = []
) {
  const descriptorByIndex = new Map(
    argumentDescriptors.map((argumentDescriptor) => [
      argumentDescriptor.index,
      cloneDescriptor(argumentDescriptor.descriptor),
    ])
  )

  for (const [index, parameter] of node.parameters.entries()) {
    const descriptor =
      descriptorByIndex.get(index) ??
      resolveTypeDescriptor(parameter.type, file, localSemantics, importedSemantics)
    if (!descriptor) {
      continue
    }
    bindPattern(scope, parameter.name, descriptor)
  }
}

function resolveTypeQueryDescriptor(
  node: ts.TypeQueryNode,
  _file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>
): Descriptor | null {
  if (!ts.isIdentifier(node.exprName)) {
    return null
  }

  const localDescriptor = localSemantics.get(node.exprName.text)
  if (localDescriptor) {
    return cloneDescriptor(localDescriptor)
  }

  const importedDescriptor = importedSemantics.get(node.exprName.text)
  return importedDescriptor ? cloneDescriptor(importedDescriptor) : null
}

function resolveInterfaceDescriptor(
  node: ts.InterfaceDeclaration,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes: Set<string>
) {
  const properties: Record<string, Descriptor> = {}
  let resolvedAny = false

  for (const heritageClause of node.heritageClauses ?? []) {
    if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue
    }

    for (const typeNode of heritageClause.types) {
      const baseDescriptor = resolveTypeDescriptor(
        typeNode,
        file,
        localSemantics,
        importedSemantics,
        seenTypes
      )
      if (baseDescriptor?.kind !== 'object') {
        continue
      }

      resolvedAny = true
      for (const [propertyName, propertyDescriptor] of Object.entries(baseDescriptor.properties)) {
        properties[propertyName] = cloneDescriptor(propertyDescriptor)
      }
    }
  }

  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type || ts.isComputedPropertyName(member.name)) {
      continue
    }

    const propertyName = getLiteralPropertyName(member.name)
    if (!propertyName) {
      continue
    }

    const propertyDescriptor = resolveTypeDescriptor(
      member.type,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    if (!propertyDescriptor) {
      continue
    }

    properties[propertyName] = propertyDescriptor
    resolvedAny = true
  }

  return resolvedAny ? objectDescriptor(properties) : null
}

function resolveTypeLiteralDescriptor(
  node: ts.TypeLiteralNode,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes: Set<string>
) {
  const properties: Record<string, Descriptor> = {}
  let resolvedAny = false

  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type || ts.isComputedPropertyName(member.name)) {
      continue
    }

    const propertyName = getLiteralPropertyName(member.name)
    if (!propertyName) {
      continue
    }

    const propertyDescriptor = resolveTypeDescriptor(
      member.type,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    if (!propertyDescriptor) {
      continue
    }

    properties[propertyName] = propertyDescriptor
    resolvedAny = true
  }

  return resolvedAny ? objectDescriptor(properties) : null
}

function resolveLocalTypeDeclarationDescriptor(
  name: string,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes: Set<string>
): Descriptor | null {
  const declaration = file.localTypeDeclarations.get(name)
  if (!declaration) {
    return null
  }

  const typeKey = `${file.filePath}:${name}`
  if (seenTypes.has(typeKey)) {
    return null
  }

  seenTypes.add(typeKey)
  const descriptor = resolveTypeDescriptor(
    declaration,
    file,
    localSemantics,
    importedSemantics,
    seenTypes
  )
  seenTypes.delete(typeKey)
  return descriptor
}

function resolveTypeDescriptor(
  typeNode: ts.TypeNode | TypeDeclarationNode | ts.ExpressionWithTypeArguments | undefined,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes = new Set<string>()
): Descriptor | null {
  if (!typeNode) {
    return null
  }

  if (ts.isTypeAliasDeclaration(typeNode)) {
    return resolveTypeDescriptor(typeNode.type, file, localSemantics, importedSemantics, seenTypes)
  }

  if (ts.isInterfaceDeclaration(typeNode)) {
    return resolveInterfaceDescriptor(typeNode, file, localSemantics, importedSemantics, seenTypes)
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolveTypeDescriptor(typeNode.type, file, localSemantics, importedSemantics, seenTypes)
  }

  if (ts.isTypeQueryNode(typeNode)) {
    return resolveTypeQueryDescriptor(typeNode, file, localSemantics, importedSemantics)
  }

  if (ts.isExpressionWithTypeArguments(typeNode)) {
    if (!ts.isIdentifier(typeNode.expression)) {
      return null
    }

    const localDescriptor = resolveLocalTypeDeclarationDescriptor(
      typeNode.expression.text,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    if (localDescriptor) {
      return localDescriptor
    }
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    if (
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeName.text === 'ReturnType' &&
      typeNode.typeArguments?.length === 1
    ) {
      const [typeArgument] = typeNode.typeArguments
      if (typeArgument && ts.isTypeQueryNode(typeArgument)) {
        return resolveTypeQueryDescriptor(typeArgument, file, localSemantics, importedSemantics)
      }
    }

    if (ts.isIdentifier(typeNode.typeName)) {
      const localDescriptor = resolveLocalTypeDeclarationDescriptor(
        typeNode.typeName.text,
        file,
        localSemantics,
        importedSemantics,
        seenTypes
      )
      if (localDescriptor) {
        return localDescriptor
      }
    }
  }

  if (ts.isIndexedAccessTypeNode(typeNode)) {
    const objectTypeDescriptor = resolveTypeDescriptor(
      typeNode.objectType,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    const propertyKey = getTypeLiteralPropertyKey(typeNode.indexType)

    if (!objectTypeDescriptor || !propertyKey) {
      return null
    }

    return readPropertyDescriptor(objectTypeDescriptor, propertyKey)
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return resolveTypeLiteralDescriptor(
      typeNode,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
  }

  return resolveStructuralTypeDescriptor(typeNode, file.typeRoots)
}

function isPropertyAccessLikeExpression(
  node: ts.Node
): node is ts.PropertyAccessExpression | ts.PropertyAccessChain {
  return ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)
}

function isElementAccessLikeExpression(
  node: ts.Node
): node is ts.ElementAccessExpression | ts.ElementAccessChain {
  return ts.isElementAccessExpression(node) || ts.isElementAccessChain(node)
}

function isCallLikeExpression(node: ts.Node): node is ts.CallExpression | ts.CallChain {
  return ts.isCallExpression(node) || ts.isCallChain(node)
}

function getAccessedPropertyName(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain
) {
  if (isPropertyAccessLikeExpression(node)) {
    return node.name.text
  }

  const argument = node.argumentExpression ? unwrapExpression(node.argumentExpression) : null
  return argument ? getStaticPropertyKey(argument) : null
}

function resolveExpressionDescriptor(
  expression: ts.Expression,
  file: ProjectFile,
  scope: Scope,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  importedCallableDescriptors: Map<string, Descriptor>
): Descriptor | null {
  const node = unwrapExpression(expression)
  const callableNode = extractCallableInitializer(node)

  if (callableNode) {
    return callableDescriptor(file.filePath, callableNode, captureClosureScope(scope))
  }

  if (ts.isIdentifier(node)) {
    const bindingDescriptor = lookupBinding(scope, node.text)
    if (bindingDescriptor) {
      return bindingDescriptor
    }

    const localFunction = file.localFunctions.get(node.text)
    if (localFunction) {
      return callableDescriptor(file.filePath, localFunction, captureClosureScope(scope))
    }

    const importedCallableDescriptor = importedCallableDescriptors.get(node.text)
    if (importedCallableDescriptor) {
      return cloneDescriptor(importedCallableDescriptor)
    }

    return null
  }

  if (isPropertyAccessLikeExpression(node)) {
    const parentDescriptor = resolveExpressionDescriptor(
      node.expression,
      file,
      scope,
      localSemantics,
      importedSemantics,
      importedCallableDescriptors
    )
    return parentDescriptor ? readPropertyDescriptor(parentDescriptor, node.name.text) : null
  }

  if (isElementAccessLikeExpression(node)) {
    const argument = node.argumentExpression ? unwrapExpression(node.argumentExpression) : null
    const propertyName = argument ? getStaticPropertyKey(argument) : null
    if (!propertyName) {
      return null
    }
    const parentDescriptor = resolveExpressionDescriptor(
      node.expression,
      file,
      scope,
      localSemantics,
      importedSemantics,
      importedCallableDescriptors
    )
    return parentDescriptor ? readPropertyDescriptor(parentDescriptor, propertyName) : null
  }

  if (isCallLikeExpression(node)) {
    return resolveCallDescriptor(node, file, scope, localSemantics, importedSemantics)
  }

  if (ts.isObjectLiteralExpression(node)) {
    const properties: Record<string, Descriptor> = {}
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const propertyName = getLiteralPropertyName(property.name)
        if (!propertyName) continue
        const propertyDescriptor = resolveExpressionDescriptor(
          property.initializer,
          file,
          scope,
          localSemantics,
          importedSemantics,
          importedCallableDescriptors
        )
        if (propertyDescriptor) {
          properties[propertyName] = propertyDescriptor
        }
      }

      if (ts.isShorthandPropertyAssignment(property)) {
        const propertyDescriptor = resolveExpressionDescriptor(
          property.name,
          file,
          scope,
          localSemantics,
          importedSemantics,
          importedCallableDescriptors
        )
        if (propertyDescriptor) {
          properties[property.name.text] = propertyDescriptor
        }
      }
    }
    return Object.keys(properties).length > 0 ? objectDescriptor(properties) : null
  }

  if (ts.isConditionalExpression(node)) {
    const whenTrue = resolveExpressionDescriptor(
      node.whenTrue,
      file,
      scope,
      localSemantics,
      importedSemantics,
      importedCallableDescriptors
    )
    const whenFalse = resolveExpressionDescriptor(
      node.whenFalse,
      file,
      scope,
      localSemantics,
      importedSemantics,
      importedCallableDescriptors
    )
    return sameDescriptor(whenTrue, whenFalse) ? whenTrue : null
  }

  return null
}

function resolveCallDescriptor(
  node: ts.CallExpression | ts.CallChain,
  file: ProjectFile,
  scope: Scope,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>
) {
  const callee = unwrapExpression(node.expression)

  if (ts.isIdentifier(callee)) {
    const localBinding = lookupBinding(scope, callee.text)
    if (localBinding?.kind === 'translator') {
      return localBinding
    }

    if (callee.text === 'useMessages' || callee.text === 'getPublicCopy') {
      return rootDescriptor([])
    }

    if (callee.text === 'useTranslations' || callee.text === 'getTranslations') {
      const firstArgument = node.arguments[0] ? unwrapExpression(node.arguments[0]!) : null
      const namespace = firstArgument ? (getStaticTextValue(firstArgument)?.split('.') ?? []) : []
      return translatorDescriptor(namespace)
    }

    if (callee.text === 'createTranslator') {
      const firstArgument = node.arguments[0]
      if (firstArgument && ts.isObjectLiteralExpression(unwrapExpression(firstArgument))) {
        const objectExpression = unwrapExpression(firstArgument) as ts.ObjectLiteralExpression
        for (const property of objectExpression.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            getLiteralPropertyName(property.name) !== 'namespace'
          ) {
            continue
          }
          const value = getStaticTextValue(unwrapExpression(property.initializer))
          if (value) {
            return translatorDescriptor(value.split('.'))
          }
        }
      }
      return null
    }

    const localFunctionDescriptor = localSemantics.get(callee.text)
    if (localFunctionDescriptor) {
      return cloneDescriptor(localFunctionDescriptor)
    }

    const importedFunctionDescriptor = importedSemantics.get(callee.text)
    if (importedFunctionDescriptor) {
      return cloneDescriptor(importedFunctionDescriptor)
    }
  }

  return null
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  )
}

function isNestedLocalFunction(node: NamedFunctionNode) {
  let current: ts.Node | undefined = node.parent

  while (current) {
    if (ts.isSourceFile(current)) {
      return false
    }

    if (isFunctionLike(current)) {
      return true
    }

    current = current.parent
  }

  return false
}

function captureClosureScope(scope: Scope) {
  const closureScope = createRootScope()
  const seenNames = new Set<string>()
  let current: Scope | null = scope

  while (current) {
    for (const [name, descriptor] of current.bindings.entries()) {
      if (seenNames.has(name)) {
        continue
      }

      seenNames.add(name)
      closureScope.bindings.set(name, descriptor)
      addScopeHints(closureScope, name, descriptor)
    }

    current = current.parent
  }

  closureScope.inMetadata = scope.inMetadata
  return closureScope
}

function bindPattern(scope: Scope, bindingName: ts.BindingName, descriptor: Descriptor) {
  if (ts.isIdentifier(bindingName)) {
    scope.bindings.set(bindingName.text, cloneDescriptor(descriptor))
    addScopeHints(scope, bindingName.text, descriptor)
    return
  }

  if (!ts.isObjectBindingPattern(bindingName) || descriptor.kind !== 'object') {
    return
  }

  for (const element of bindingName.elements) {
    if (element.dotDotDotToken) {
      continue
    }
    const propertyName =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null
    if (!propertyName) {
      continue
    }
    const propertyDescriptor = descriptor.properties[propertyName]
    if (!propertyDescriptor) {
      continue
    }
    bindPattern(scope, element.name, propertyDescriptor)
  }
}

function addScopeHints(scope: Scope, name: string, descriptor: Descriptor) {
  if (descriptor.kind === 'translator' && descriptor.namespace.length > 0) {
    scope.translatorHints.push({ name, namespace: descriptor.namespace })
    return
  }

  if (descriptor.kind === 'root' && descriptor.path.length > 0 && ROOT_HINT_NAME.test(name)) {
    scope.rootHints.push({ name, path: descriptor.path })
  }
}

function getNodeLocation(sourceFile: ts.SourceFile, position: number) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position)
  return { line: line + 1, column: character + 1 }
}

function isRouteAdjacentCandidateFile(
  filePath: string,
  activeRoutePath: string | null,
  context: ScanContext
) {
  if (!activeRoutePath) {
    return false
  }

  if (!isPathInsideDirectory(filePath, context.entryDiscoveryContext.appRoot)) {
    return false
  }

  const owningRoutePath = resolveAppRoutePathForFile(context.entryDiscoveryContext, filePath)
  return Boolean(owningRoutePath && isRoutePathPrefix(owningRoutePath, activeRoutePath))
}

function buildImportedSemanticsMap(
  file: ProjectFile,
  _projectFiles: Map<string, ProjectFile>,
  globalSemantics: Map<string, Map<string, Descriptor>>
) {
  const importedSemantics = new Map<string, Descriptor>()

  for (const binding of file.importBindings.values()) {
    if (!binding.resolvedFilePath) {
      continue
    }
    const fileSemantics = globalSemantics.get(binding.resolvedFilePath)
    const descriptor = fileSemantics?.get(binding.importedName)
    if (descriptor) {
      importedSemantics.set(binding.localName, cloneDescriptor(descriptor))
    }

    if (!descriptor && binding.importedName === 'default') {
      const defaultDescriptor = fileSemantics?.get('default')
      if (defaultDescriptor) {
        importedSemantics.set(binding.localName, cloneDescriptor(defaultDescriptor))
      }
    }
  }

  return importedSemantics
}

function buildImportedCallableDescriptorMap(
  file: ProjectFile,
  projectFiles: Map<string, ProjectFile>
) {
  const importedCallableDescriptors = new Map<string, Descriptor>()

  for (const binding of file.importBindings.values()) {
    if (!binding.resolvedFilePath) {
      continue
    }

    const importedFile = projectFiles.get(binding.resolvedFilePath)
    if (!importedFile) {
      continue
    }

    const target = resolveExportedFunctionTarget(projectFiles, importedFile, binding.importedName)
    if (!target) {
      continue
    }

    importedCallableDescriptors.set(
      binding.localName,
      callableDescriptor(target.targetFile.filePath, target.targetNode, createRootScope())
    )
  }

  return importedCallableDescriptors
}

function buildGlobalFunctionSemantics(projectFiles: Map<string, ProjectFile>) {
  const semanticsByFile = new Map<string, Map<string, Descriptor>>()

  let changed = true
  while (changed) {
    changed = false
    for (const [filePath, file] of projectFiles.entries()) {
      const importedSemantics = buildImportedSemanticsMap(file, projectFiles, semanticsByFile)
      const importedCallableDescriptors = buildImportedCallableDescriptorMap(file, projectFiles)
      const fileSemantics = inferFileSemantics(file, importedSemantics, importedCallableDescriptors)
      const exportedSemantics = new Map<string, Descriptor>()

      for (const name of file.exportedFunctions) {
        const descriptor = fileSemantics.get(name)
        if (descriptor) {
          exportedSemantics.set(name, cloneDescriptor(descriptor))
        }
      }

      if (file.defaultExportFunction) {
        const defaultDescriptor = inferFunctionDescriptor(
          file.defaultExportFunction,
          file,
          fileSemantics,
          importedSemantics,
          importedCallableDescriptors
        )
        if (defaultDescriptor) {
          exportedSemantics.set('default', cloneDescriptor(defaultDescriptor))
        }
      }

      for (const binding of file.localExportBindings) {
        const descriptor =
          fileSemantics.get(binding.localName) ?? importedSemantics.get(binding.localName) ?? null
        if (descriptor) {
          exportedSemantics.set(binding.exportedName, cloneDescriptor(descriptor))
        }
      }

      for (const binding of file.reExportBindings) {
        if (!binding.resolvedFilePath) {
          continue
        }

        const sourceSemantics = semanticsByFile.get(binding.resolvedFilePath)
        const descriptor = sourceSemantics?.get(binding.importedName)
        if (descriptor) {
          exportedSemantics.set(binding.exportedName, cloneDescriptor(descriptor))
        }
      }

      for (const exportAllPath of file.exportAllPaths) {
        const sourceSemantics = semanticsByFile.get(exportAllPath)
        if (!sourceSemantics) {
          continue
        }

        for (const [name, descriptor] of sourceSemantics.entries()) {
          if (name === 'default' || exportedSemantics.has(name)) {
            continue
          }
          exportedSemantics.set(name, cloneDescriptor(descriptor))
        }
      }

      const existing = semanticsByFile.get(filePath) ?? new Map<string, Descriptor>()
      const nextKey = [...exportedSemantics.entries()]
        .map(([name, descriptor]) => `${name}:${descriptorToPathKey(descriptor)}`)
        .sort()
        .join('|')
      const existingKey = [...existing.entries()]
        .map(([name, descriptor]) => `${name}:${descriptorToPathKey(descriptor)}`)
        .sort()
        .join('|')

      if (nextKey !== existingKey) {
        semanticsByFile.set(filePath, exportedSemantics)
        changed = true
      }
    }
  }

  return semanticsByFile
}

export function createCatalogProjectContext(projectRoot: string): CatalogProjectContext {
  return {
    entryDiscoveryContext: createEntryDiscoveryContext(projectRoot),
    projectFiles: new Map(),
    projectRoot,
  }
}

function fileMayExportName(
  filePath: string,
  exportName: string,
  context: CatalogProjectContext,
  seen = new Set<string>()
) {
  if (seen.has(filePath)) {
    return false
  }

  seen.add(filePath)

  const projectFile = getProjectFile(context, filePath)
  if (!projectFile) {
    return false
  }

  if (projectFile.exportedValueNames.has(exportName)) {
    return true
  }

  for (const exportAllPath of projectFile.exportAllPaths) {
    if (fileMayExportName(exportAllPath, exportName, context, seen)) {
      return true
    }
  }

  return false
}

function collectReachableFiles(entryFiles: string[], context: CatalogProjectContext) {
  const visited = new Set<string>()
  const requestedByFile = new Map<string, RequestedExports>()
  const processedByFile = new Map<string, RequestedExports>()
  const pending: PendingReachability[] = []

  const enqueue = (filePath: string, requestedExports: RequestedExports) => {
    if (!getProjectFile(context, filePath)) {
      return
    }

    const currentRequest = requestedByFile.get(filePath)
    if (requestedExportsCover(currentRequest, requestedExports)) {
      return
    }

    const mergedRequest = mergeRequestedExports(currentRequest, requestedExports)
    requestedByFile.set(filePath, mergedRequest)
    pending.push({
      filePath,
      requestedExports: cloneRequestedExports(mergedRequest),
    })
  }

  for (const entryFile of entryFiles) {
    enqueue(entryFile, 'all')
  }

  while (pending.length > 0) {
    const { filePath: currentFilePath } = pending.pop()!
    const requestedExports = requestedByFile.get(currentFilePath)
    if (!requestedExports) {
      continue
    }

    const processedRequest = processedByFile.get(currentFilePath)
    if (requestedExportsCover(processedRequest, requestedExports)) {
      continue
    }

    processedByFile.set(currentFilePath, cloneRequestedExports(requestedExports))
    visited.add(currentFilePath)

    const projectFile = getProjectFile(context, currentFilePath)
    if (!projectFile) {
      continue
    }

    for (const runtimeImportEdge of projectFile.runtimeImportEdges) {
      enqueue(runtimeImportEdge.resolvedFilePath, runtimeImportEdge.requestedExports)
    }

    if (requestedExports === 'all') {
      for (const binding of projectFile.reExportBindings) {
        if (!binding.resolvedFilePath) {
          continue
        }
        enqueue(binding.resolvedFilePath, requestedExportsForName(binding.importedName))
      }

      for (const exportAllPath of projectFile.exportAllPaths) {
        enqueue(exportAllPath, 'all')
      }

      continue
    }

    const satisfiedNames = new Set(projectFile.exportedValueNames)
    if (projectFile.hasDefaultExport) {
      satisfiedNames.add('default')
    }

    for (const binding of projectFile.reExportBindings) {
      if (!requestedExports.has(binding.exportedName)) {
        continue
      }

      satisfiedNames.add(binding.exportedName)

      if (binding.resolvedFilePath) {
        enqueue(binding.resolvedFilePath, requestedExportsForName(binding.importedName))
      }
    }

    for (const requestedName of requestedExports) {
      if (requestedName === 'default' || satisfiedNames.has(requestedName)) {
        continue
      }

      for (const exportAllPath of projectFile.exportAllPaths) {
        if (!fileMayExportName(exportAllPath, requestedName, context)) {
          continue
        }

        enqueue(exportAllPath, requestedExportsForName(requestedName))
        satisfiedNames.add(requestedName)
        break
      }
    }
  }

  return [...visited].sort()
}

function buildAnalysisProjectFiles(context: CatalogProjectContext, runtimeFilePaths: string[]) {
  const visited = new Set<string>()
  const pending = [...runtimeFilePaths]

  while (pending.length > 0) {
    const filePath = pending.pop()!
    if (visited.has(filePath)) {
      continue
    }

    const projectFile = getProjectFile(context, filePath)
    if (!projectFile) {
      continue
    }

    visited.add(filePath)

    for (const binding of projectFile.typeImportBindings.values()) {
      if (binding.resolvedFilePath) {
        pending.push(binding.resolvedFilePath)
      }
    }

    for (const binding of projectFile.typeReExportBindings) {
      if (binding.resolvedFilePath) {
        pending.push(binding.resolvedFilePath)
      }
    }

    for (const binding of projectFile.reExportBindings) {
      if (binding.resolvedFilePath) {
        pending.push(binding.resolvedFilePath)
      }
    }

    for (const exportAllPath of projectFile.exportAllPaths) {
      pending.push(exportAllPath)
    }
  }

  return new Map(
    [...visited].sort().map((filePath) => [filePath, context.projectFiles.get(filePath)!] as const)
  )
}

function resolveNamespaceHint(
  scope: Scope,
  filePath: string,
  context: ScanContext,
  metadata: boolean,
  activeRoutePath: string | null
) {
  const translatorHint = findTranslatorHint(scope, (hint) => hint.namespace.length > 0)
  if (translatorHint) {
    return {
      namespace: translatorHint.namespace.join('.'),
      source: 'static' as const,
    }
  }

  const rootHint = findRootHint(scope, (hint) => hint.path.length > 0)
  if (rootHint) {
    return {
      namespace: rootHint.path.join('.'),
      source: 'static' as const,
    }
  }

  const routePath =
    activeRoutePath ??
    context.routePath ??
    resolveOwningRoutePathForFile(context.entryDiscoveryContext, filePath)
  if (!routePath) {
    return null
  }

  const namespace = deriveRouteNamespace(routePath, { metadata })
  return {
    namespace,
    source:
      activeRoutePath === null && context.routePath === null
        ? ('ownership' as const)
        : getRouteOwnedNamespaces(routePath).includes(namespace)
          ? ('ownership' as const)
          : ('fallback' as const),
  }
}

function isUiStringLiteral(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return false
  }
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/.test(trimmed)) {
    return false
  }
  if (/^[A-Z0-9_-]+$/.test(trimmed) && !/\s/.test(trimmed)) {
    return false
  }
  if (/^[a-z0-9_.-]+$/.test(trimmed) && !/\s/.test(trimmed)) {
    return false
  }
  return true
}

function slugifyCopyText(text: string) {
  const words = text
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) {
    return 'copy'
  }
  const [firstWord, ...restWords] = words
  return [
    firstWord!.toLowerCase(),
    ...restWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()),
  ].join('')
}

function shouldCapturePropertyAccess(node: ts.Node) {
  const parent = node.parent
  if (isPropertyAccessLikeExpression(parent) && parent.expression === node) {
    return false
  }
  if (isElementAccessLikeExpression(parent) && parent.expression === node) {
    return false
  }
  return true
}

function isRuntimeArrayMethodAccess(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain
) {
  const propertyName = getAccessedPropertyName(node)
  return (
    Boolean(propertyName) &&
    ARRAY_CONSUMER_METHOD_NAMES.has(propertyName!) &&
    isCallLikeExpression(node.parent) &&
    node.parent.expression === node
  )
}

function isRuntimeLengthAccess(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain
) {
  return getAccessedPropertyName(node) === 'length'
}

function shouldSuppressRuntimePropertyAccess(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain,
  descriptor: Descriptor
) {
  if (descriptor.kind !== 'root') {
    return false
  }

  return isRuntimeArrayMethodAccess(node) || isRuntimeLengthAccess(node)
}

function getFileAnalysis(file: ProjectFile, context: ScanContext): FileAnalysis {
  const cached = context.analysisByFile.get(file.filePath)
  if (cached) {
    return cached
  }

  const importedSemantics = buildImportedSemanticsMap(
    file,
    context.projectFiles,
    context.semanticsByFile
  )
  const importedCallableDescriptors = buildImportedCallableDescriptorMap(file, context.projectFiles)
  const localSemantics = inferFileSemantics(file, importedSemantics, importedCallableDescriptors)
  const analysis: FileAnalysis = {
    file,
    importedCallableDescriptors,
    importedSemantics,
    localSemantics,
  }

  context.analysisByFile.set(file.filePath, analysis)
  return analysis
}

function captureExactCoverage(
  state: ScanState,
  file: ProjectFile,
  node: ts.Node,
  descriptor: Descriptor,
  source: CoverageRecord['source']
) {
  if (descriptor.kind !== 'root' || descriptor.path.length === 0) {
    return
  }

  const location = getNodeLocation(file.sourceFile, node.getStart(file.sourceFile))
  state.coverage.push({
    filePath: file.filePath,
    line: location.line,
    column: location.column,
    path: descriptor.path,
    pathKey: descriptor.path.join('.'),
    mode: 'exact',
    source,
  })
}

function captureSubtreeCoverage(
  state: ScanState,
  file: ProjectFile,
  node: ts.Node,
  descriptor: Descriptor,
  source: CoverageRecord['source'],
  subtreeReason: NonNullable<CoverageRecord['subtreeReason']>
) {
  if (descriptor.kind !== 'root' && descriptor.kind !== 'translator') {
    return
  }

  const pathParts = descriptor.kind === 'root' ? descriptor.path : descriptor.namespace
  if (pathParts.length === 0) {
    return
  }

  const location = getNodeLocation(file.sourceFile, node.getStart(file.sourceFile))
  state.coverage.push({
    filePath: file.filePath,
    line: location.line,
    column: location.column,
    path: pathParts,
    pathKey: pathParts.join('.'),
    mode: 'subtree',
    source,
    subtreeReason,
  })
}

function captureHardcodedCandidate(
  state: ScanState,
  context: ScanContext,
  analysis: FileAnalysis,
  activeScope: Scope,
  node: ts.Node,
  text: string,
  options: { kind: HardcodedCandidate['kind']; attributeName?: string; metadata?: boolean },
  activeRoutePath: string | null
) {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  if (!isUiStringLiteral(normalizedText)) {
    return
  }

  const namespaceHint = resolveNamespaceHint(
    activeScope,
    analysis.file.filePath,
    context,
    Boolean(options.metadata),
    activeRoutePath
  )
  if (!namespaceHint) {
    return
  }

  const { namespace, source } = namespaceHint
  if (
    source !== 'static' &&
    !isRouteAdjacentCandidateFile(analysis.file.filePath, activeRoutePath, context)
  ) {
    return
  }

  const componentSegment = deriveComponentKeySegment(analysis.file.filePath, context.projectRoot)
  const fileBasename = path.basename(analysis.file.filePath, path.extname(analysis.file.filePath))
  const namespaceTerminalSegment = namespace.split('.').filter(Boolean).at(-1) ?? ''
  const shouldSuppressComponentSegment =
    source !== 'static' &&
    (fileBasename === 'page' || fileBasename === 'layout' || fileBasename === 'index') &&
    componentSegment === namespaceTerminalSegment
  const relativeKeyParts =
    source === 'static'
      ? [slugifyCopyText(normalizedText)]
      : shouldSuppressComponentSegment
        ? [slugifyCopyText(normalizedText)]
        : [componentSegment, slugifyCopyText(normalizedText)]
  const location = getNodeLocation(
    analysis.file.sourceFile,
    node.getStart(analysis.file.sourceFile)
  )

  state.hardcodedCandidates.push({
    filePath: analysis.file.filePath,
    line: location.line,
    column: location.column,
    text: normalizedText,
    kind: options.kind,
    namespace,
    namespaceSource: source,
    relativeKeyParts,
    attributeName: options.attributeName,
    metadata: Boolean(options.metadata),
  })
}

function resolveExportedFunctionTarget(
  projectFiles: Map<string, ProjectFile>,
  file: ProjectFile,
  exportName: string,
  seen = new Set<string>()
): ExportedFunctionTarget | null {
  const cacheKey = `${file.filePath}:${exportName}`
  if (seen.has(cacheKey)) {
    return null
  }

  seen.add(cacheKey)

  if (exportName === 'default') {
    if (file.defaultExportFunction) {
      return {
        targetFile: file,
        targetNode: file.defaultExportFunction,
      }
    }

    if (file.defaultExportBindingName) {
      const localTarget = file.localFunctions.get(file.defaultExportBindingName)
      if (localTarget) {
        return {
          targetFile: file,
          targetNode: localTarget,
        }
      }

      const importedBinding = file.importBindings.get(file.defaultExportBindingName)
      if (importedBinding?.resolvedFilePath) {
        const importedFile = projectFiles.get(importedBinding.resolvedFilePath)
        if (importedFile) {
          return resolveExportedFunctionTarget(
            projectFiles,
            importedFile,
            importedBinding.importedName,
            seen
          )
        }
      }
    }
  }

  if (exportName !== 'default' && file.exportedFunctions.has(exportName)) {
    const localTarget = file.localFunctions.get(exportName)
    if (localTarget) {
      return {
        targetFile: file,
        targetNode: localTarget,
      }
    }
  }

  for (const binding of file.localExportBindings) {
    if (binding.exportedName !== exportName) {
      continue
    }

    const localTarget = file.localFunctions.get(binding.localName)
    if (localTarget) {
      return {
        targetFile: file,
        targetNode: localTarget,
      }
    }

    const importedBinding = file.importBindings.get(binding.localName)
    if (!importedBinding?.resolvedFilePath) {
      continue
    }

    const importedFile = projectFiles.get(importedBinding.resolvedFilePath)
    if (!importedFile) {
      continue
    }

    const importedTarget = resolveExportedFunctionTarget(
      projectFiles,
      importedFile,
      importedBinding.importedName,
      seen
    )
    if (importedTarget) {
      return importedTarget
    }
  }

  for (const binding of file.reExportBindings) {
    if (binding.exportedName !== exportName || !binding.resolvedFilePath) {
      continue
    }

    const importedFile = projectFiles.get(binding.resolvedFilePath)
    if (!importedFile) {
      continue
    }

    const importedTarget = resolveExportedFunctionTarget(
      projectFiles,
      importedFile,
      binding.importedName,
      seen
    )
    if (importedTarget) {
      return importedTarget
    }
  }

  for (const exportAllPath of file.exportAllPaths) {
    const importedFile = projectFiles.get(exportAllPath)
    if (!importedFile) {
      continue
    }

    const importedTarget = resolveExportedFunctionTarget(
      projectFiles,
      importedFile,
      exportName,
      seen
    )
    if (importedTarget) {
      return importedTarget
    }
  }

  return null
}

function resolveCallableTargetFromIdentifier(
  identifier: ts.Identifier,
  analysis: FileAnalysis,
  scope: Scope,
  context: ScanContext,
  activeRoutePath: string | null
): CallableTarget | null {
  const binding = lookupBinding(scope, identifier.text)
  if (binding) {
    return binding.kind === 'callable'
      ? resolveCallableTargetFromDescriptor(binding, context, activeRoutePath)
      : null
  }

  const localTarget = analysis.file.localFunctions.get(identifier.text)
  if (localTarget) {
    return {
      activeRoutePath,
      closureScope: isNestedLocalFunction(localTarget) ? scope : null,
      targetFile: analysis.file,
      targetNode: localTarget,
      targetImportedSemantics: analysis.importedSemantics,
    }
  }

  const importBinding = analysis.file.importBindings.get(identifier.text)
  if (!importBinding?.resolvedFilePath) {
    return null
  }

  const importedFile = context.projectFiles.get(importBinding.resolvedFilePath)
  if (!importedFile) {
    return null
  }

  const target = resolveExportedFunctionTarget(
    context.projectFiles,
    importedFile,
    importBinding.importedName
  )
  if (!target) {
    return null
  }

  return {
    activeRoutePath,
    closureScope: null,
    ...target,
    targetImportedSemantics: getFileAnalysis(target.targetFile, context).importedSemantics,
  }
}

function resolveCallableTargetFromDescriptor(
  descriptor: Extract<Descriptor, { kind: 'callable' }>,
  context: ScanContext,
  activeRoutePath: string | null
): CallableTarget | null {
  const targetFile = context.projectFiles.get(descriptor.filePath)
  if (!targetFile) {
    return null
  }

  return {
    activeRoutePath,
    closureScope: descriptor.closureScope,
    targetFile,
    targetNode: descriptor.targetNode,
    targetImportedSemantics: getFileAnalysis(targetFile, context).importedSemantics,
  }
}

function resolveCallableTargetFromExpression(
  expression: ts.Expression,
  analysis: FileAnalysis,
  scope: Scope,
  context: ScanContext,
  activeRoutePath: string | null
): CallableTarget | null {
  const descriptor = resolveExpressionDescriptor(
    expression,
    analysis.file,
    scope,
    analysis.localSemantics,
    analysis.importedSemantics,
    analysis.importedCallableDescriptors
  )
  if (descriptor?.kind === 'callable') {
    return resolveCallableTargetFromDescriptor(descriptor, context, activeRoutePath)
  }

  const callee = unwrapExpression(expression)
  if (ts.isIdentifier(callee)) {
    return resolveCallableTargetFromIdentifier(callee, analysis, scope, context, activeRoutePath)
  }

  return null
}

function resolveCallableTargetFromJsx(
  tagName: ts.JsxTagNameExpression,
  analysis: FileAnalysis,
  scope: Scope,
  context: ScanContext,
  activeRoutePath: string | null
): CallableTarget | null {
  if (!ts.isIdentifier(tagName) || /^[a-z]/.test(tagName.text)) {
    return null
  }

  return resolveCallableTargetFromIdentifier(tagName, analysis, scope, context, activeRoutePath)
}

function isIntrinsicJsxTagName(tagName: ts.JsxTagNameExpression) {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text)
}

function buildArgumentDescriptorList(
  args: ts.NodeArray<ts.Expression>,
  analysis: FileAnalysis,
  scope: Scope
) {
  const descriptors: ArgumentDescriptor[] = []

  for (const [index, argument] of args.entries()) {
    const descriptor = resolveExpressionDescriptor(
      argument,
      analysis.file,
      scope,
      analysis.localSemantics,
      analysis.importedSemantics,
      analysis.importedCallableDescriptors
    )
    if (descriptor) {
      descriptors.push({ index, descriptor })
    }
  }

  return descriptors
}

function buildJsxPropsDescriptor(
  attributes: ts.JsxAttributes,
  analysis: FileAnalysis,
  scope: Scope
): Descriptor | null {
  const properties: Record<string, Descriptor> = {}

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      const spreadDescriptor = resolveExpressionDescriptor(
        property.expression,
        analysis.file,
        scope,
        analysis.localSemantics,
        analysis.importedSemantics,
        analysis.importedCallableDescriptors
      )

      if (spreadDescriptor?.kind === 'object') {
        for (const [propertyName, propertyDescriptor] of Object.entries(
          spreadDescriptor.properties
        )) {
          properties[propertyName] = cloneDescriptor(propertyDescriptor)
        }
      }
      continue
    }

    if (!ts.isIdentifier(property.name) || !property.initializer) {
      continue
    }

    let descriptor: Descriptor | null = null
    if (ts.isJsxExpression(property.initializer) && property.initializer.expression) {
      descriptor = resolveExpressionDescriptor(
        property.initializer.expression,
        analysis.file,
        scope,
        analysis.localSemantics,
        analysis.importedSemantics,
        analysis.importedCallableDescriptors
      )
    }

    if (descriptor) {
      properties[property.name.text] = descriptor
    }
  }

  return Object.keys(properties).length > 0 ? objectDescriptor(properties) : null
}

function captureArrayConsumerReference(
  node: ts.CallExpression | ts.CallChain,
  analysis: FileAnalysis,
  scope: Scope,
  state: ScanState
) {
  const { methodName, receiver } = resolveCallPropertyTarget(node)

  if (!methodName || !receiver || !ARRAY_CONSUMER_METHOD_NAMES.has(methodName)) {
    return
  }

  const descriptor = resolveExpressionDescriptor(
    receiver,
    analysis.file,
    scope,
    analysis.localSemantics,
    analysis.importedSemantics,
    analysis.importedCallableDescriptors
  )
  if (descriptor?.kind === 'root') {
    captureSubtreeCoverage(state, analysis.file, receiver, descriptor, 'copy-access', 'array-root')
  }
}

function resolveCallPropertyTarget(node: ts.CallExpression | ts.CallChain) {
  const callee = unwrapExpression(node.expression)

  if (isPropertyAccessLikeExpression(callee)) {
    return {
      methodName: callee.name.text,
      receiver: callee.expression,
    }
  }

  if (isElementAccessLikeExpression(callee) && callee.argumentExpression) {
    return {
      methodName: getStaticPropertyKey(unwrapExpression(callee.argumentExpression)),
      receiver: callee.expression,
    }
  }

  return {
    methodName: null,
    receiver: null,
  }
}

function captureArrayLengthReference(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain,
  analysis: FileAnalysis,
  scope: Scope,
  state: ScanState
) {
  if (!isRuntimeLengthAccess(node)) {
    return
  }

  const descriptor = resolveExpressionDescriptor(
    node.expression,
    analysis.file,
    scope,
    analysis.localSemantics,
    analysis.importedSemantics,
    analysis.importedCallableDescriptors
  )
  if (descriptor?.kind === 'root') {
    captureSubtreeCoverage(state, analysis.file, node, descriptor, 'copy-access', 'array-root')
  }
}

function scanFunctionBody(
  node: ts.FunctionLikeDeclaration,
  scope: Scope,
  analysis: FileAnalysis,
  context: ScanContext,
  state: ScanState,
  activeRoutePath: string | null
) {
  if (!node.body) {
    return
  }

  scanNodeWithScope(node.body, scope, analysis, context, state, activeRoutePath)
}

function getRuntimeCallbackArgumentIndexes(node: ts.CallExpression | ts.CallChain) {
  const callee = unwrapExpression(node.expression)

  if (ts.isIdentifier(callee)) {
    if (
      RUNTIME_CALLBACK_HOOK_NAMES.has(callee.text) ||
      RUNTIME_CALLBACK_FUNCTION_NAMES.has(callee.text)
    ) {
      return [0]
    }
  }

  const { methodName } = resolveCallPropertyTarget(node)
  if (!methodName) {
    return []
  }

  if (
    ARRAY_RUNTIME_CALLBACK_METHOD_NAMES.has(methodName) ||
    RUNTIME_CALLBACK_HOOK_NAMES.has(methodName)
  ) {
    return [0]
  }

  if (methodName === 'then') {
    return [0, 1]
  }

  if (methodName === 'catch' || methodName === 'finally') {
    return [0]
  }

  return []
}

function scanRuntimeCallbackArguments(
  node: ts.CallExpression | ts.CallChain,
  scope: Scope,
  analysis: FileAnalysis,
  context: ScanContext,
  state: ScanState,
  activeRoutePath: string | null
) {
  for (const index of getRuntimeCallbackArgumentIndexes(node)) {
    const callbackExpression = node.arguments[index]
    if (!callbackExpression) {
      continue
    }

    const target = resolveCallableTargetFromExpression(
      callbackExpression,
      analysis,
      scope,
      context,
      activeRoutePath
    )
    if (target) {
      scanCallableInvocation(target, [], context, state)
    }
  }
}

function scanCallableInvocation(
  target: CallableTarget,
  argumentDescriptors: ArgumentDescriptor[],
  context: ScanContext,
  state: ScanState
) {
  const descriptorSignature = argumentDescriptors
    .map(
      (argumentDescriptor) =>
        `${argumentDescriptor.index}:${descriptorToPathKey(argumentDescriptor.descriptor)}`
    )
    .join('|')
  const closureSignature = getScopeBindingSignature(target.closureScope)
  const invocationKey = `${target.targetFile.filePath}:${target.targetNode.getStart(target.targetFile.sourceFile)}:${target.activeRoutePath ?? ''}:${descriptorSignature}:${closureSignature}`

  if (context.invocationCache.has(invocationKey)) {
    return
  }

  context.invocationCache.add(invocationKey)

  if (!target.targetNode.body) {
    return
  }

  const targetAnalysis = getFileAnalysis(target.targetFile, context)
  const scope = createFunctionScope(target.closureScope ?? createRootScope(), target.targetNode)
  bindFunctionParameters(
    scope,
    target.targetNode,
    target.targetFile,
    targetAnalysis.localSemantics,
    target.targetImportedSemantics,
    argumentDescriptors
  )
  scanFunctionBody(target.targetNode, scope, targetAnalysis, context, state, target.activeRoutePath)
}

function scanExportEntry(
  file: ProjectFile,
  exportName: string,
  context: ScanContext,
  state: ScanState,
  activeRoutePath: string | null
) {
  const target = resolveExportedFunctionTarget(context.projectFiles, file, exportName)
  if (!target) {
    return
  }

  scanCallableInvocation(
    {
      activeRoutePath,
      closureScope: null,
      ...target,
      targetImportedSemantics: getFileAnalysis(target.targetFile, context).importedSemantics,
    },
    [],
    context,
    state
  )
}

function scanNodeWithScope(
  node: ts.Node,
  scope: Scope,
  analysis: FileAnalysis,
  context: ScanContext,
  state: ScanState,
  activeRoutePath: string | null
) {
  if (isFunctionLike(node)) {
    return
  }

  if (ts.isBlock(node) && !isFunctionLike(node.parent)) {
    const blockScope = createBlockScope(scope)
    ts.forEachChild(node, (child) =>
      scanNodeWithScope(child, blockScope, analysis, context, state, activeRoutePath)
    )
    return
  }

  if (
    ts.isCaseBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    const blockScope = createBlockScope(scope)
    ts.forEachChild(node, (child) =>
      scanNodeWithScope(child, blockScope, analysis, context, state, activeRoutePath)
    )
    return
  }

  if (ts.isVariableDeclaration(node) && node.initializer) {
    const descriptor = resolveExpressionDescriptor(
      node.initializer,
      analysis.file,
      scope,
      analysis.localSemantics,
      analysis.importedSemantics,
      analysis.importedCallableDescriptors
    )
    if (descriptor) {
      bindVariableDeclaration(scope, node, descriptor)
    }

    if (
      ts.isIdentifier(node.name) &&
      (node.name.text === 'metadata' || node.name.text === 'metadataBase') &&
      ts.isObjectLiteralExpression(unwrapExpression(node.initializer))
    ) {
      const metadataScope = createBlockScope(scope, { inMetadata: true })
      scanNodeWithScope(node.initializer, metadataScope, analysis, context, state, activeRoutePath)
      return
    }
  }

  if (isCallLikeExpression(node)) {
    captureArrayConsumerReference(node, analysis, scope, state)
    scanRuntimeCallbackArguments(node, scope, analysis, context, state, activeRoutePath)

    const calleeDescriptor = resolveExpressionDescriptor(
      node.expression,
      analysis.file,
      scope,
      analysis.localSemantics,
      analysis.importedSemantics,
      analysis.importedCallableDescriptors
    )
    if (calleeDescriptor?.kind === 'translator') {
      const firstArgument = node.arguments[0] ? unwrapExpression(node.arguments[0]!) : null
      const pathSuffix = firstArgument ? getStaticTextValue(firstArgument) : null

      if (pathSuffix) {
        captureExactCoverage(
          state,
          analysis.file,
          node,
          rootDescriptor([...calleeDescriptor.namespace, ...pathSuffix.split('.')]),
          'translation'
        )
      } else {
        captureSubtreeCoverage(
          state,
          analysis.file,
          node,
          calleeDescriptor,
          'translation',
          'dynamic-root'
        )
      }
    }

    const argumentDescriptors = buildArgumentDescriptorList(node.arguments, analysis, scope)
    const target = resolveCallableTargetFromExpression(
      node.expression,
      analysis,
      scope,
      context,
      activeRoutePath
    )
    if (target) {
      scanCallableInvocation(target, argumentDescriptors, context, state)
    }
  }

  if (
    (isPropertyAccessLikeExpression(node) || isElementAccessLikeExpression(node)) &&
    shouldCapturePropertyAccess(node)
  ) {
    captureArrayLengthReference(node, analysis, scope, state)

    const descriptor = resolveExpressionDescriptor(
      node as ts.Expression,
      analysis.file,
      scope,
      analysis.localSemantics,
      analysis.importedSemantics,
      analysis.importedCallableDescriptors
    )
    if (descriptor?.kind === 'root' && !shouldSuppressRuntimePropertyAccess(node, descriptor)) {
      captureExactCoverage(state, analysis.file, node, descriptor, 'copy-access')
    }

    if (isElementAccessLikeExpression(node)) {
      const argument = node.argumentExpression ? unwrapExpression(node.argumentExpression) : null
      if (!argument || !getStaticPropertyKey(argument)) {
        const parentDescriptor = resolveExpressionDescriptor(
          node.expression,
          analysis.file,
          scope,
          analysis.localSemantics,
          analysis.importedSemantics,
          analysis.importedCallableDescriptors
        )
        if (parentDescriptor) {
          captureSubtreeCoverage(
            state,
            analysis.file,
            node,
            parentDescriptor,
            'copy-access',
            'dynamic-root'
          )
        }
      }
    }
  }

  if (ts.isJsxText(node)) {
    captureHardcodedCandidate(
      state,
      context,
      analysis,
      scope,
      node,
      node.getText(analysis.file.sourceFile),
      {
        kind: 'jsx-text',
      },
      activeRoutePath
    )
  }

  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const propsDescriptor = buildJsxPropsDescriptor(node.attributes, analysis, scope)
    const target = resolveCallableTargetFromJsx(
      node.tagName,
      analysis,
      scope,
      context,
      activeRoutePath
    )
    if (target) {
      scanCallableInvocation(
        target,
        propsDescriptor ? [{ index: 0, descriptor: propsDescriptor }] : [],
        context,
        state
      )
    }
  }

  if (
    ts.isJsxAttribute(node) &&
    node.initializer &&
    ts.isStringLiteral(node.initializer) &&
    ts.isIdentifier(node.name) &&
    HARD_CODED_PROP_NAMES.has(node.name.text)
  ) {
    captureHardcodedCandidate(
      state,
      context,
      analysis,
      scope,
      node.initializer,
      node.initializer.text,
      {
        kind: 'jsx-attribute',
        attributeName: node.name.text,
      },
      activeRoutePath
    )
  }

  if (
    ts.isJsxAttribute(node) &&
    ts.isIdentifier(node.name) &&
    /^on[A-Z]/.test(node.name.text) &&
    node.initializer &&
    ts.isJsxExpression(node.initializer) &&
    node.initializer.expression &&
    (ts.isJsxOpeningElement(node.parent.parent) ||
      ts.isJsxSelfClosingElement(node.parent.parent)) &&
    isIntrinsicJsxTagName(node.parent.parent.tagName)
  ) {
    const target = resolveCallableTargetFromExpression(
      node.initializer.expression,
      analysis,
      scope,
      context,
      activeRoutePath
    )
    if (target) {
      scanCallableInvocation(target, [], context, state)
    }
  }

  if (
    scope.inMetadata &&
    ts.isPropertyAssignment(node) &&
    node.initializer &&
    METADATA_PROP_NAMES.has(getLiteralPropertyName(node.name) ?? '')
  ) {
    const staticText = getStaticTextValue(unwrapExpression(node.initializer))
    if (staticText) {
      captureHardcodedCandidate(
        state,
        context,
        analysis,
        scope,
        node.initializer,
        staticText,
        {
          kind: 'metadata',
          attributeName: getLiteralPropertyName(node.name) ?? undefined,
          metadata: true,
        },
        activeRoutePath
      )
    }
  }

  ts.forEachChild(node, (child) =>
    scanNodeWithScope(child, scope, analysis, context, state, activeRoutePath)
  )
}

function scanFile(analysis: FileAnalysis, context: ScanContext, options: ScanFileOptions) {
  const state: ScanState = {
    coverage: [],
    hardcodedCandidates: [],
  }

  for (const activeRoutePath of dedupeNullableStrings(options.rootScanRoutePaths)) {
    scanNodeWithScope(
      analysis.file.sourceFile,
      createRootScope(),
      analysis,
      context,
      state,
      activeRoutePath
    )
  }

  for (const entryInvocation of options.entryInvocations) {
    scanExportEntry(
      analysis.file,
      entryInvocation.exportName,
      context,
      state,
      entryInvocation.activeRoutePath
    )
  }
  return state
}

function dedupeHardcodedCandidates(candidates: HardcodedCandidate[]) {
  const deduped: HardcodedCandidate[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const key = [
      candidate.filePath,
      candidate.line,
      candidate.column,
      candidate.text,
      candidate.namespace,
      candidate.kind,
      candidate.attributeName ?? '',
      candidate.metadata ? '1' : '0',
    ].join(':')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(candidate)
  }

  return deduped
}

export function scanCatalogProjectWithContext(
  context: CatalogProjectContext,
  options: ContextScanOptions
): CatalogScanResult {
  let routeResolution: ReturnType<typeof resolveRouteEntries> | null = null
  const entryDiscovery =
    options.mode === 'route'
      ? ((routeResolution = resolveRouteEntries(
          context.entryDiscoveryContext,
          options.routePath
        )) as ReturnType<typeof resolveRouteEntries>)
      : discoverAllModeEntries(context.entryDiscoveryContext)

  const selectedFiles = collectReachableFiles(entryDiscovery.entryFiles, context)
  const analysisProjectFiles = buildAnalysisProjectFiles(context, selectedFiles)
  populateProjectFileTypeRoots(analysisProjectFiles)
  const semanticsByFile = buildGlobalFunctionSemantics(analysisProjectFiles)

  const routePath = routeResolution?.routePath ?? null
  const ownedNamespaces = routePath ? getRouteOwnedNamespaces(routePath) : []
  const scanContext: ScanContext = {
    analysisByFile: new Map(),
    entryDiscoveryContext: context.entryDiscoveryContext,
    projectRoot: context.projectRoot,
    projectFiles: analysisProjectFiles,
    semanticsByFile,
    routePath,
    invocationCache: new Set(),
  }
  const coverage: CoverageRecord[] = []
  const hardcodedCandidates: HardcodedCandidate[] = []

  for (const filePath of selectedFiles) {
    const projectFile = analysisProjectFiles.get(filePath)
    if (!projectFile) {
      continue
    }

    const entryExportNames = entryDiscovery.entryExportNamesByFile.get(filePath) ?? []
    const entryActiveRoutePath =
      routePath ?? resolveOwningRoutePathForFile(context.entryDiscoveryContext, filePath)
    const entryInvocations = entryExportNames.map((exportName) => ({
      exportName,
      activeRoutePath: entryActiveRoutePath,
    }))
    const rootScanRoutePaths =
      routePath !== null
        ? [routePath]
        : entryInvocations.length > 0
          ? entryInvocations.map((entryInvocation) => entryInvocation.activeRoutePath)
          : [null]

    const scanResult = scanFile(getFileAnalysis(projectFile, scanContext), scanContext, {
      entryInvocations,
      rootScanRoutePaths,
    })
    coverage.push(...scanResult.coverage)
    hardcodedCandidates.push(...scanResult.hardcodedCandidates)
  }

  return {
    mode: options.mode,
    routePath,
    ownedNamespaces,
    scannedFiles: selectedFiles.map((filePath) =>
      toRelativeProjectPath(context.projectRoot, filePath)
    ),
    coverage,
    hardcodedCandidates: dedupeHardcodedCandidates(hardcodedCandidates),
  }
}

export function scanCatalogProject(options: ScanOptions): CatalogScanResult {
  const context = createCatalogProjectContext(options.projectRoot)
  return scanCatalogProjectWithContext(
    context,
    options.mode === 'route' ? { mode: 'route', routePath: options.routePath } : { mode: 'all' }
  )
}
