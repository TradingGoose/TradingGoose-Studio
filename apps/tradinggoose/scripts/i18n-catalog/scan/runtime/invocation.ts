import ts from 'typescript'
import { unwrapExpression } from '../core/ast'
import { descriptorToPathKey } from '../core/descriptors'
import {
  ARRAY_RUNTIME_CALLBACK_METHOD_NAMES,
  RUNTIME_CALLBACK_FUNCTION_NAMES,
  RUNTIME_CALLBACK_HOOK_NAMES,
} from '../core/rules'
import { createFunctionScope, createRootScope, getScopeBindingSignature } from '../core/scope'
import type { ArgumentDescriptor, CallableTarget, ProjectFile, Scope, WalkEnv } from '../core/types'
import { resolveExportedFunctionTarget } from '../graph/exports'
import { getFileAnalysis } from '../semantics/analysis-cache'
import { bindFunctionParameters } from '../semantics/parameters'
import { resolveCallPropertyTarget } from './property-access'
import { resolveCallableTargetFromExpression } from './targets'

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
  const target = resolveExportedFunctionTarget(env.context.projectFiles, file, exportName)
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
