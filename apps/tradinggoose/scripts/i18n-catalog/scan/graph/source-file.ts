import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import {
  isIgnoredProjectPath,
  isPathInsideDirectory,
  SOURCE_EXTENSIONS,
  toRelativeProjectPath,
} from '../../entries'
import { collectBindingNames, extractCallableInitializer, getScriptKind } from '../core/ast'
import {
  cloneRequestedExports,
  mergeRequestedExports,
  requestedExportsForName,
} from '../core/descriptors'
import type {
  CatalogProjectContext,
  ImportBinding,
  LocalExportBinding,
  NamedFunctionNode,
  ProjectFile,
  ReExportBinding,
  RequestedExports,
  TypeDeclarationNode,
  TypeExportBinding,
  TypeImportBinding,
  TypeReExportBinding,
} from '../core/types'

function isSourceFilePath(filePath: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension))
}

function resolveImportPath(
  projectRoot: string,
  importerFilePath: string,
  specifier: string
): string | null {
  let basePath: string | null = null
  if (specifier.startsWith('@/')) {
    basePath = path.join(projectRoot, specifier.slice(2))
  } else if (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  ) {
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
    if (!isPathInsideDirectory(candidate, projectRoot)) {
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
  const topLevelVariableDeclarations = new Map<string, ts.VariableDeclaration>()
  const topLevelCallableDeclarations = new Map<string, NamedFunctionNode>()

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

  const resolveTopLevelCallable = (name: string) => topLevelCallableDeclarations.get(name) ?? null

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      topLevelCallableDeclarations.set(node.name.text, node)
    }

    if (!ts.isVariableStatement(node)) {
      return
    }

    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        topLevelVariableDeclarations.set(declaration.name.text, declaration)
      }
    }
  })

  let discoveredTopLevelCallable = true
  while (discoveredTopLevelCallable) {
    discoveredTopLevelCallable = false

    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isVariableStatement(node)) {
        return
      }

      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue
        }

        const functionTarget = extractCallableInitializer(
          declaration.initializer,
          resolveTopLevelCallable
        )
        if (!functionTarget) {
          continue
        }

        if (topLevelCallableDeclarations.get(declaration.name.text) === functionTarget) {
          continue
        }

        topLevelCallableDeclarations.set(declaration.name.text, functionTarget)
        discoveredTopLevelCallable = true
      }
    })
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
          const functionTarget = extractCallableInitializer(
            declaration.initializer,
            resolveTopLevelCallable
          )
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
      const functionTarget = extractCallableInitializer(node.expression, resolveTopLevelCallable)
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
    topLevelVariableDeclarations,
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

export function getProjectFile(
  context: CatalogProjectContext,
  filePath: string
): ProjectFile | null {
  const cached = context.projectFiles.get(filePath)
  if (cached) {
    return cached
  }

  if (!isPathInsideDirectory(filePath, context.projectRoot) || !isSourceFilePath(filePath)) {
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
