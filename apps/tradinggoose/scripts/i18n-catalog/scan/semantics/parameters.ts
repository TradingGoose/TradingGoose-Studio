import { cloneDescriptor } from '../core/descriptors'
import { bindPattern } from '../core/scope'
import type { ArgumentDescriptor, FileSemantics, ProjectFile, Scope } from '../core/types'
import { resolveTypeDescriptor } from './type-resolution'

export function bindFunctionParameters(
  scope: Scope,
  node: import('typescript').FunctionLikeDeclaration,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, import('../core/types').Descriptor>,
  argumentDescriptors: ArgumentDescriptor[] = []
): void {
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
