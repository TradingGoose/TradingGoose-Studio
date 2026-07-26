import type ts from 'typescript'
import type { EntryDiscoveryContext, EntryExportName } from '../../entries'

export type Descriptor =
  | { kind: 'root'; path: string[] }
  | { kind: 'translator'; namespace: string[] }
  | { kind: 'object'; properties: Record<string, Descriptor> }
  | { kind: 'callable'; filePath: string; closureScope: Scope; targetNode: NamedFunctionNode }

export type NamedFunctionNode = ts.FunctionLikeDeclaration & {
  name?: ts.PropertyName | ts.BindingName
}

export type ImportBinding = {
  importedName: string
  localName: string
  resolvedFilePath: string | null
}

export type ReExportBinding = {
  importedName: string
  exportedName: string
  resolvedFilePath: string | null
}

export type LocalExportBinding = {
  localName: string
  exportedName: string
}

export type TypeImportBinding = {
  importedName: string
  localName: string
  resolvedFilePath: string | null
}

export type TypeExportBinding = {
  localName: string
  exportedName: string
}

export type TypeReExportBinding = {
  importedName: string
  exportedName: string
  resolvedFilePath: string | null
}

export type TypeDeclarationNode = ts.TypeAliasDeclaration | ts.InterfaceDeclaration

export type RequestedExports = 'all' | Set<string>

export type RuntimeImportEdge = {
  resolvedFilePath: string
  requestedExports: RequestedExports
}

export type PendingReachability = {
  filePath: string
  requestedExports: RequestedExports
}

export type ProjectFile = {
  filePath: string
  relativePath: string
  sourceFile: ts.SourceFile
  topLevelVariableDeclarations: Map<string, ts.VariableDeclaration>
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

export type TranslatorHint = {
  name: string
  namespace: string[]
}

export type RootHint = {
  name: string
  path: string[]
}

export type ScopeKind = 'root' | 'function' | 'block'

export type Scope = {
  kind: ScopeKind
  parent: Scope | null
  hoistTarget: Scope | null
  bindings: Map<string, Descriptor>
  translatorHints: TranslatorHint[]
  rootHints: RootHint[]
  currentFunction: ts.FunctionLikeDeclaration | null
  inMetadata: boolean
}

export type FunctionSemantics = Map<string, Descriptor>
export type FileSemantics = Map<string, Descriptor>

export type ArgumentDescriptor = {
  index: number
  descriptor: Descriptor
}

export type FileAnalysis = {
  file: ProjectFile
  importedCallableDescriptors: Map<string, Descriptor>
  importedSemantics: Map<string, Descriptor>
  localSemantics: Map<string, Descriptor>
}

export type ExportedFunctionTarget = {
  targetFile: ProjectFile
  targetNode: NamedFunctionNode
}

export type CallableTarget = {
  activeRoutePath: string | null
  closureScope: Scope | null
  targetFile: ProjectFile
  targetNode: NamedFunctionNode
  targetImportedSemantics: Map<string, Descriptor>
}

export type ScanState = {
  coverage: CoverageRecord[]
  hardcodedCandidates: HardcodedCandidate[]
}

export type ScanContext = {
  entryDiscoveryContext: EntryDiscoveryContext
  projectRoot: string
  projectFiles: Map<string, ProjectFile>
  semanticsByFile: Map<string, Map<string, Descriptor>>
  analysisByFile: Map<string, FileAnalysis>
  routePath: string | null
  invocationCache: Set<string>
}

export type EntryInvocation = {
  activeRoutePath: string | null
  exportName: EntryExportName
}

export type ScanFileOptions = {
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

export type ResolverEnv = {
  file: ProjectFile
  localSemantics: FileSemantics
  importedSemantics: Map<string, Descriptor>
  importedCallableDescriptors: Map<string, Descriptor>
}

export type WalkEnv = {
  activeRoutePath: string | null
  analysis: FileAnalysis
  context: ScanContext
  state: ScanState
}
