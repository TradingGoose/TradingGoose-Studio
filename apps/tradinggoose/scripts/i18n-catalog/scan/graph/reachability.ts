import {
  cloneRequestedExports,
  mergeRequestedExports,
  requestedExportsCover,
  requestedExportsForName,
} from '../core/descriptors'
import type {
  CatalogProjectContext,
  PendingReachability,
  ProjectFile,
  RequestedExports,
} from '../core/types'
import { getProjectFile } from './source-file'

type ReachabilityOptions = {
  skipRuntimeImportsFrom?: Set<string>
}

function fileMayExportName(
  filePath: string,
  exportName: string,
  context: CatalogProjectContext,
  seen = new Set<string>()
): boolean {
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

export function collectReachableFiles(
  entryFiles: string[],
  context: CatalogProjectContext,
  options?: ReachabilityOptions
): string[] {
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

    if (!options?.skipRuntimeImportsFrom?.has(currentFilePath)) {
      for (const runtimeImportEdge of projectFile.runtimeImportEdges) {
        enqueue(runtimeImportEdge.resolvedFilePath, runtimeImportEdge.requestedExports)
      }
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

export function buildAnalysisProjectFiles(
  context: CatalogProjectContext,
  runtimeFilePaths: string[]
): Map<string, ProjectFile> {
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
