import type { ExportedFunctionTarget, ProjectFile } from '../core/types'

export function resolveExportedFunctionTarget(
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
