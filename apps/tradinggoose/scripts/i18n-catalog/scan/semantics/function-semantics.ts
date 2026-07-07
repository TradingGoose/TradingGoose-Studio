import ts from 'typescript'
import { isFunctionLike } from '../core/ast'
import { cloneDescriptor, descriptorToPathKey, sameDescriptor } from '../core/descriptors'
import { createFunctionScope, createRootScope } from '../core/scope'
import type {
  Descriptor,
  FileSemantics,
  NamedFunctionNode,
  ProjectFile,
  ResolverEnv,
} from '../core/types'
import { buildImportedCallableDescriptorMap, buildImportedSemanticsMap } from './analysis-cache'
import { resolveExpressionDescriptor } from './expression-resolution'
import { bindFunctionParameters } from './parameters'

export function inferFileSemantics(
  file: ProjectFile,
  importedSemantics: Map<string, Descriptor>,
  importedCallableDescriptors: Map<string, Descriptor>
): Map<string, Descriptor> {
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

export function inferFunctionDescriptor(
  node: NamedFunctionNode,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  importedCallableDescriptors: Map<string, Descriptor>
): Descriptor | null {
  const scope = createFunctionScope(createRootScope(), node)
  bindFunctionParameters(scope, node, file, localSemantics, importedSemantics)
  const env: ResolverEnv = {
    file,
    localSemantics,
    importedSemantics,
    importedCallableDescriptors,
  }

  if (!node.body) {
    return null
  }

  if (!ts.isBlock(node.body)) {
    return resolveExpressionDescriptor(node.body, scope, env)
  }

  const descriptors: Descriptor[] = []

  const visit = (currentNode: ts.Node) => {
    if (currentNode !== node.body && isFunctionLike(currentNode)) {
      return
    }

    if (ts.isReturnStatement(currentNode) && currentNode.expression) {
      const descriptor = resolveExpressionDescriptor(currentNode.expression, scope, env)
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

export function buildGlobalFunctionSemantics(
  projectFiles: Map<string, ProjectFile>
): Map<string, Map<string, Descriptor>> {
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
