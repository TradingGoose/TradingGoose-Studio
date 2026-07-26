import ts from 'typescript'
import {
  getStaticTextValue,
  isCallLikeExpression,
  isFunctionLike,
  unwrapExpression,
} from '../core/ast'
import { rootDescriptor } from '../core/descriptors'
import {
  bindVariableDeclaration,
  createBlockScope,
  createRootScope,
  dedupeNullableStrings,
} from '../core/scope'
import type {
  FileAnalysis,
  ScanContext,
  ScanFileOptions,
  ScanState,
  Scope,
  WalkEnv,
} from '../core/types'
import { resolveExpressionDescriptor } from '../semantics/expression-resolution'
import { captureExactCoverage, captureSubtreeCoverage } from './candidates'
import { scanCallableInvocation, scanExportEntry, scanRuntimeCallbackArguments } from './invocation'
import {
  handleIntrinsicJsxEventAttribute,
  handleJsxComponentInvocation,
  handleJsxText,
  handleLiteralJsxAttribute,
  handleMetadataProperty,
} from './jsx'
import { captureArrayConsumerReference, handlePropertyAccess } from './property-access'
import { buildArgumentDescriptorList, resolveCallableTargetFromExpression } from './targets'

function handleScopeEntry(node: ts.Node, scope: Scope, env: WalkEnv): boolean {
  if (isFunctionLike(node)) {
    return true
  }

  if (ts.isBlock(node) && !isFunctionLike(node.parent)) {
    const blockScope = createBlockScope(scope)
    ts.forEachChild(node, (child) => scanNodeWithScope(child, blockScope, env))
    return true
  }

  if (
    ts.isCaseBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  ) {
    const blockScope = createBlockScope(scope)
    ts.forEachChild(node, (child) => scanNodeWithScope(child, blockScope, env))
    return true
  }

  return false
}

function handleVariableDeclaration(node: ts.Node, scope: Scope, env: WalkEnv): boolean {
  if (!ts.isVariableDeclaration(node) || !node.initializer) {
    return false
  }

  const descriptor = resolveExpressionDescriptor(node.initializer, scope, env.analysis)
  if (descriptor) {
    bindVariableDeclaration(scope, node, descriptor)
  }

  if (
    ts.isIdentifier(node.name) &&
    (node.name.text === 'metadata' || node.name.text === 'metadataBase') &&
    ts.isObjectLiteralExpression(unwrapExpression(node.initializer))
  ) {
    const metadataScope = createBlockScope(scope, { inMetadata: true })
    scanNodeWithScope(node.initializer, metadataScope, env)
    return true
  }

  return false
}

function handleCallLikeExpression(node: ts.Node, scope: Scope, env: WalkEnv): void {
  if (!isCallLikeExpression(node)) {
    return
  }

  captureArrayConsumerReference(node, scope, env)
  scanRuntimeCallbackArguments(node, scope, env, scanNodeWithScope)

  const calleeDescriptor = resolveExpressionDescriptor(node.expression, scope, env.analysis)
  if (calleeDescriptor?.kind === 'translator') {
    const firstArgument = node.arguments[0] ? unwrapExpression(node.arguments[0]!) : null
    const pathSuffix = firstArgument ? getStaticTextValue(firstArgument) : null

    if (pathSuffix) {
      captureExactCoverage(
        env.state,
        env.analysis.file,
        node,
        rootDescriptor([...calleeDescriptor.namespace, ...pathSuffix.split('.')]),
        'translation'
      )
    } else {
      captureSubtreeCoverage(
        env.state,
        env.analysis.file,
        node,
        calleeDescriptor,
        'translation',
        'dynamic-root'
      )
    }
  }

  const argumentDescriptors = buildArgumentDescriptorList(node.arguments, env.analysis, scope)
  const target = resolveCallableTargetFromExpression(
    node.expression,
    env.analysis,
    scope,
    env.context,
    env.activeRoutePath
  )
  if (target) {
    scanCallableInvocation(target, argumentDescriptors, env, scanNodeWithScope)
  }
}

export function scanNodeWithScope(node: ts.Node, scope: Scope, env: WalkEnv): void {
  if (handleScopeEntry(node, scope, env)) {
    return
  }

  if (handleVariableDeclaration(node, scope, env)) {
    return
  }

  handleCallLikeExpression(node, scope, env)
  handlePropertyAccess(node, scope, env)
  handleJsxText(node, scope, env)
  handleJsxComponentInvocation(node, scope, env, (target, argumentDescriptors) =>
    scanCallableInvocation(target, argumentDescriptors, env, scanNodeWithScope)
  )
  handleLiteralJsxAttribute(node, scope, env)
  handleIntrinsicJsxEventAttribute(node, scope, env, (target, argumentDescriptors) =>
    scanCallableInvocation(target, argumentDescriptors, env, scanNodeWithScope)
  )
  handleMetadataProperty(node, scope, env)

  ts.forEachChild(node, (child) => scanNodeWithScope(child, scope, env))
}

export function scanFile(
  analysis: FileAnalysis,
  context: ScanContext,
  options: ScanFileOptions
): ScanState {
  const state: ScanState = {
    coverage: [],
    hardcodedCandidates: [],
  }

  for (const activeRoutePath of dedupeNullableStrings(options.rootScanRoutePaths)) {
    scanNodeWithScope(analysis.file.sourceFile, createRootScope(), {
      activeRoutePath,
      analysis,
      context,
      state,
    })
  }

  for (const entryInvocation of options.entryInvocations) {
    scanExportEntry(
      analysis.file,
      entryInvocation.exportName,
      {
        activeRoutePath: entryInvocation.activeRoutePath,
        analysis,
        context,
        state,
      },
      scanNodeWithScope
    )
  }

  return state
}
