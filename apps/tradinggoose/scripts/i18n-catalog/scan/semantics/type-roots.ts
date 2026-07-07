import {
  cloneDescriptor,
  descriptorMapsEqual,
  rootDescriptor,
  sameDescriptor,
} from '../core/descriptors'
import type { Descriptor, ProjectFile } from '../core/types'
import { resolveStructuralTypeDescriptor } from './type-resolution'

export function createBuiltinTypeRoots(): Map<string, Descriptor> {
  return new Map<string, Descriptor>([
    ['Messages', rootDescriptor([])],
    ['PublicCopy', rootDescriptor([])],
  ])
}

function buildTypeRootsForFile(
  file: ProjectFile,
  exportedTypeDescriptorsByFile: Map<string, Map<string, Descriptor>>
): Map<string, Descriptor> {
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
): Map<string, Descriptor> {
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

export function populateProjectFileTypeRoots(projectFiles: Map<string, ProjectFile>): void {
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
