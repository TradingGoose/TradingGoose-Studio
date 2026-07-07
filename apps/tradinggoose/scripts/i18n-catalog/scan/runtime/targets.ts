import ts from 'typescript'
import { isNestedLocalFunction, unwrapExpression } from '../core/ast'
import { cloneDescriptor, objectDescriptor } from '../core/descriptors'
import { lookupBinding } from '../core/scope'
import type {
  ArgumentDescriptor,
  CallableTarget,
  Descriptor,
  FileAnalysis,
  ScanContext,
  Scope,
} from '../core/types'
import { resolveExportedFunctionTarget } from '../graph/exports'
import { getFileAnalysis } from '../semantics/analysis-cache'
import { resolveExpressionDescriptor } from '../semantics/expression-resolution'

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

export function resolveCallableTargetFromExpression(
  expression: ts.Expression,
  analysis: FileAnalysis,
  scope: Scope,
  context: ScanContext,
  activeRoutePath: string | null
): CallableTarget | null {
  const descriptor = resolveExpressionDescriptor(expression, scope, analysis)
  if (descriptor?.kind === 'callable') {
    return resolveCallableTargetFromDescriptor(descriptor, context, activeRoutePath)
  }

  const callee = unwrapExpression(expression)
  if (ts.isIdentifier(callee)) {
    return resolveCallableTargetFromIdentifier(callee, analysis, scope, context, activeRoutePath)
  }

  return null
}

export function resolveCallableTargetFromJsx(
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

export function isIntrinsicJsxTagName(tagName: ts.JsxTagNameExpression): boolean {
  return ts.isIdentifier(tagName) && /^[a-z]/.test(tagName.text)
}

export function buildArgumentDescriptorList(
  args: ts.NodeArray<ts.Expression>,
  analysis: FileAnalysis,
  scope: Scope
): ArgumentDescriptor[] {
  const descriptors: ArgumentDescriptor[] = []

  for (const [index, argument] of args.entries()) {
    const descriptor = resolveExpressionDescriptor(argument, scope, analysis)
    if (descriptor) {
      descriptors.push({ index, descriptor })
    }
  }

  return descriptors
}

export function buildJsxPropsDescriptor(
  attributes: ts.JsxAttributes,
  analysis: FileAnalysis,
  scope: Scope
): Descriptor | null {
  const properties: Record<string, Descriptor> = {}

  for (const property of attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      const spreadDescriptor = resolveExpressionDescriptor(property.expression, scope, analysis)

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
      descriptor = resolveExpressionDescriptor(property.initializer.expression, scope, analysis)
    }

    if (descriptor) {
      properties[property.name.text] = descriptor
    }
  }

  return Object.keys(properties).length > 0 ? objectDescriptor(properties) : null
}
