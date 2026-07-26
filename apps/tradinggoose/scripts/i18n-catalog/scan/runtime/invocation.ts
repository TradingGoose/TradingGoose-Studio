import ts from 'typescript'
import { unwrapExpression } from '../core/ast'
import { descriptorToPathKey, readPropertyDescriptor } from '../core/descriptors'
import {
  ARRAY_RUNTIME_CALLBACK_METHOD_NAMES,
  RUNTIME_CALLBACK_FUNCTION_NAMES,
  RUNTIME_CALLBACK_HOOK_NAMES,
} from '../core/rules'
import { createFunctionScope, createRootScope, getScopeBindingSignature } from '../core/scope'
import type { ArgumentDescriptor, CallableTarget, ProjectFile, Scope, WalkEnv } from '../core/types'
import { resolveExportedFunctionTarget } from '../graph/exports'
import { getFileAnalysis } from '../semantics/analysis-cache'
import { resolveExpressionDescriptor } from '../semantics/expression-resolution'
import { bindFunctionParameters } from '../semantics/parameters'
import { resolveCallPropertyTarget } from './property-access'
import {
  resolveCallableTargetFromDescriptor,
  resolveCallableTargetFromExpression,
} from './targets'

type NodeScanner = (node: ts.Node, scope: Scope, env: WalkEnv) => void

function scanFunctionBody(
  node: ts.FunctionLikeDeclaration,
  scope: Scope,
  env: WalkEnv,
  scanNodeWithScope: NodeScanner
): void {
  if (!node.body) {
    return
  }

  scanNodeWithScope(node.body, scope, env)
}

function resolveDottedExportCallableTarget(
  file: ProjectFile,
  exportName: string,
  env: WalkEnv
): CallableTarget | null {
  const [baseExportName, ...propertySegments] = exportName.split('.')
  if (!baseExportName || propertySegments.length === 0) {
    return null
  }

  const localBindingName =
    (baseExportName === 'default' ? file.defaultExportBindingName : null) ??
    (file.exportedValueNames.has(baseExportName) &&
    file.topLevelVariableDeclarations.has(baseExportName)
      ? baseExportName
      : null) ??
    file.localExportBindings.find((binding) => binding.exportedName === baseExportName)
      ?.localName ??
    null
  if (!localBindingName) {
    return null
  }

  const declaration = file.topLevelVariableDeclarations.get(localBindingName)
  if (!declaration?.initializer) {
    return null
  }

  const analysis =
    env.analysis.file.filePath === file.filePath
      ? env.analysis
      : getFileAnalysis(file, env.context)
  let descriptor = resolveExpressionDescriptor(declaration.initializer, createRootScope(), analysis)

  for (const propertySegment of propertySegments) {
    if (!descriptor) {
      return null
    }
    descriptor = readPropertyDescriptor(descriptor, propertySegment)
  }

  if (descriptor?.kind !== 'callable') {
    return null
  }

  return resolveCallableTargetFromDescriptor(descriptor, env.context, env.activeRoutePath)
}

function getRuntimeCallbackArgumentIndexes(node: ts.CallExpression | ts.CallChain): number[] {
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

export function scanRuntimeCallbackArguments(
  node: ts.CallExpression | ts.CallChain,
  scope: Scope,
  env: WalkEnv,
  scanNodeWithScope: NodeScanner
): void {
  for (const index of getRuntimeCallbackArgumentIndexes(node)) {
    const callbackExpression = node.arguments[index]
    if (!callbackExpression) {
      continue
    }

    const target = resolveCallableTargetFromExpression(
      callbackExpression,
      env.analysis,
      scope,
      env.context,
      env.activeRoutePath
    )
    if (target) {
      scanCallableInvocation(target, [], env, scanNodeWithScope)
    }
  }
}

export function scanCallableInvocation(
  target: CallableTarget,
  argumentDescriptors: ArgumentDescriptor[],
  env: WalkEnv,
  scanNodeWithScope: NodeScanner
): void {
  const descriptorSignature = argumentDescriptors
    .map(
      (argumentDescriptor) =>
        `${argumentDescriptor.index}:${descriptorToPathKey(argumentDescriptor.descriptor)}`
    )
    .join('|')
  const closureSignature = getScopeBindingSignature(target.closureScope)
  const invocationKey = `${target.targetFile.filePath}:${target.targetNode.getStart(target.targetFile.sourceFile)}:${target.activeRoutePath ?? ''}:${descriptorSignature}:${closureSignature}`

  if (env.context.invocationCache.has(invocationKey)) {
    return
  }

  env.context.invocationCache.add(invocationKey)

  if (!target.targetNode.body) {
    return
  }

  const targetAnalysis = getFileAnalysis(target.targetFile, env.context)
  const scope = createFunctionScope(target.closureScope ?? createRootScope(), target.targetNode)
  bindFunctionParameters(
    scope,
    target.targetNode,
    target.targetFile,
    targetAnalysis.localSemantics,
    target.targetImportedSemantics,
    argumentDescriptors
  )
  scanFunctionBody(
    target.targetNode,
    scope,
    {
      ...env,
      activeRoutePath: target.activeRoutePath,
      analysis: targetAnalysis,
    },
    scanNodeWithScope
  )
}

export function scanExportEntry(
  file: ProjectFile,
  exportName: string,
  env: WalkEnv,
  scanNodeWithScope: NodeScanner
): void {
  const target = exportName.includes('.')
    ? resolveDottedExportCallableTarget(file, exportName, env)
    : resolveExportedFunctionTarget(env.context.projectFiles, file, exportName)
  if (!target) {
    return
  }

  scanCallableInvocation(
    {
      activeRoutePath: env.activeRoutePath,
      closureScope: null,
      ...target,
      targetImportedSemantics: getFileAnalysis(target.targetFile, env.context).importedSemantics,
    },
    [],
    env,
    scanNodeWithScope
  )
}
