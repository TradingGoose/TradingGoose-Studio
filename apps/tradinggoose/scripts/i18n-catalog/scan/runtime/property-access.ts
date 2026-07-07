import type ts from 'typescript'
import {
  getAccessedPropertyName,
  getStaticPropertyKey,
  isCallLikeExpression,
  isElementAccessLikeExpression,
  isPropertyAccessLikeExpression,
  unwrapExpression,
} from '../core/ast'
import { ARRAY_CONSUMER_METHOD_NAMES } from '../core/rules'
import type { Descriptor, Scope, WalkEnv } from '../core/types'
import { resolveExpressionDescriptor } from '../semantics/expression-resolution'
import { captureExactCoverage, captureSubtreeCoverage } from './candidates'

export function shouldCapturePropertyAccess(node: ts.Node): boolean {
  const parent = node.parent
  if (isPropertyAccessLikeExpression(parent) && parent.expression === node) {
    return false
  }

  if (isElementAccessLikeExpression(parent) && parent.expression === node) {
    return false
  }

  return true
}

export function isRuntimeArrayMethodAccess(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain
): boolean {
  const propertyName = getAccessedPropertyName(node)
  return (
    Boolean(propertyName) &&
    ARRAY_CONSUMER_METHOD_NAMES.has(propertyName!) &&
    isCallLikeExpression(node.parent) &&
    node.parent.expression === node
  )
}

export function isRuntimeLengthAccess(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain
): boolean {
  return getAccessedPropertyName(node) === 'length'
}

export function shouldSuppressRuntimePropertyAccess(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain,
  descriptor: Descriptor
): boolean {
  if (descriptor.kind !== 'root') {
    return false
  }

  return isRuntimeArrayMethodAccess(node) || isRuntimeLengthAccess(node)
}

export function resolveCallPropertyTarget(node: ts.CallExpression | ts.CallChain): {
  methodName: string | null
  receiver: ts.Expression | null
} {
  const callee = unwrapExpression(node.expression)

  if (isPropertyAccessLikeExpression(callee)) {
    return {
      methodName: callee.name.text,
      receiver: callee.expression,
    }
  }

  if (isElementAccessLikeExpression(callee) && callee.argumentExpression) {
    return {
      methodName: getStaticPropertyKey(unwrapExpression(callee.argumentExpression)),
      receiver: callee.expression,
    }
  }

  return {
    methodName: null,
    receiver: null,
  }
}

export function captureArrayConsumerReference(
  node: ts.CallExpression | ts.CallChain,
  scope: Scope,
  env: WalkEnv
): void {
  const { methodName, receiver } = resolveCallPropertyTarget(node)

  if (!methodName || !receiver || !ARRAY_CONSUMER_METHOD_NAMES.has(methodName)) {
    return
  }

  const descriptor = resolveExpressionDescriptor(receiver, scope, env.analysis)
  if (descriptor?.kind === 'root') {
    captureSubtreeCoverage(
      env.state,
      env.analysis.file,
      receiver,
      descriptor,
      'copy-access',
      'array-root'
    )
  }
}

function captureArrayLengthReference(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain,
  scope: Scope,
  env: WalkEnv
): void {
  if (!isRuntimeLengthAccess(node)) {
    return
  }

  const descriptor = resolveExpressionDescriptor(node.expression, scope, env.analysis)
  if (descriptor?.kind === 'root') {
    captureSubtreeCoverage(
      env.state,
      env.analysis.file,
      node,
      descriptor,
      'copy-access',
      'array-root'
    )
  }
}

export function handlePropertyAccess(node: ts.Node, scope: Scope, env: WalkEnv): void {
  if (
    !(isPropertyAccessLikeExpression(node) || isElementAccessLikeExpression(node)) ||
    !shouldCapturePropertyAccess(node)
  ) {
    return
  }

  captureArrayLengthReference(node, scope, env)

  const descriptor = resolveExpressionDescriptor(node as ts.Expression, scope, env.analysis)
  if (descriptor?.kind === 'root' && !shouldSuppressRuntimePropertyAccess(node, descriptor)) {
    captureExactCoverage(env.state, env.analysis.file, node, descriptor, 'copy-access')
  }

  if (isElementAccessLikeExpression(node)) {
    const argument = node.argumentExpression ? unwrapExpression(node.argumentExpression) : null
    if (!argument || !getStaticPropertyKey(argument)) {
      const parentDescriptor = resolveExpressionDescriptor(node.expression, scope, env.analysis)
      if (parentDescriptor) {
        captureSubtreeCoverage(
          env.state,
          env.analysis.file,
          node,
          parentDescriptor,
          'copy-access',
          'dynamic-root'
        )
      }
    }
  }
}
