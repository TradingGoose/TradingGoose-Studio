import { callableDescriptor, cloneDescriptor } from '../core/descriptors'
import { createRootScope } from '../core/scope'
import type { Descriptor, FileAnalysis, ProjectFile, ScanContext } from '../core/types'
import { resolveExportedFunctionTarget } from '../graph/exports'
import { inferFileSemantics } from './function-semantics'

export function buildImportedSemanticsMap(
  file: ProjectFile,
  _projectFiles: Map<string, ProjectFile>,
  globalSemantics: Map<string, Map<string, Descriptor>>
): Map<string, Descriptor> {
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

export function buildImportedCallableDescriptorMap(
  file: ProjectFile,
  projectFiles: Map<string, ProjectFile>
): Map<string, Descriptor> {
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

export function getFileAnalysis(file: ProjectFile, context: ScanContext): FileAnalysis {
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
