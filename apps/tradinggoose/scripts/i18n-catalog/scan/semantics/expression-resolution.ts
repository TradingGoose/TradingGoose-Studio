import ts from 'typescript'
import {
  extractCallableInitializer,
  getLiteralPropertyName,
  getStaticPropertyKey,
  getStaticTextValue,
  isCallLikeExpression,
  isElementAccessLikeExpression,
  isPropertyAccessLikeExpression,
  unwrapExpression,
} from '../core/ast'
import {
  callableDescriptor,
  cloneDescriptor,
  objectDescriptor,
  readPropertyDescriptor,
  rootDescriptor,
  sameDescriptor,
  translatorDescriptor,
} from '../core/descriptors'
import { captureClosureScope, lookupBinding } from '../core/scope'
import type { Descriptor, ResolverEnv, Scope } from '../core/types'

function resolveCallDescriptor(
  node: ts.CallExpression | ts.CallChain,
  scope: Scope,
  env: ResolverEnv
): Descriptor | null {
  const callee = unwrapExpression(node.expression)

  if (ts.isIdentifier(callee)) {
    const localBinding = lookupBinding(scope, callee.text)
    if (localBinding?.kind === 'translator') {
      return localBinding
    }

    if (callee.text === 'useMessages' || callee.text === 'getPublicCopy') {
      return rootDescriptor([])
    }

    if (callee.text === 'useTranslations' || callee.text === 'getTranslations') {
      const firstArgument = node.arguments[0] ? unwrapExpression(node.arguments[0]!) : null
      const namespace = firstArgument ? (getStaticTextValue(firstArgument)?.split('.') ?? []) : []
      return translatorDescriptor(namespace)
    }

    if (callee.text === 'createTranslator') {
      const firstArgument = node.arguments[0]
      if (firstArgument && ts.isObjectLiteralExpression(unwrapExpression(firstArgument))) {
        const objectExpression = unwrapExpression(firstArgument) as ts.ObjectLiteralExpression
        for (const property of objectExpression.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            getLiteralPropertyName(property.name) !== 'namespace'
          ) {
            continue
          }
          const value = getStaticTextValue(unwrapExpression(property.initializer))
          if (value) {
            return translatorDescriptor(value.split('.'))
          }
        }
      }
      return null
    }

    const localFunctionDescriptor = env.localSemantics.get(callee.text)
    if (localFunctionDescriptor) {
      return cloneDescriptor(localFunctionDescriptor)
    }

    const importedFunctionDescriptor = env.importedSemantics.get(callee.text)
    if (importedFunctionDescriptor) {
      return cloneDescriptor(importedFunctionDescriptor)
    }
  }

  return null
}

export function resolveExpressionDescriptor(
  expression: ts.Expression,
  scope: Scope,
  env: ResolverEnv
): Descriptor | null {
  const node = unwrapExpression(expression)
  const callableNode = extractCallableInitializer(node)

  if (callableNode) {
    return callableDescriptor(env.file.filePath, callableNode, captureClosureScope(scope))
  }

  if (ts.isIdentifier(node)) {
    const bindingDescriptor = lookupBinding(scope, node.text)
    if (bindingDescriptor) {
      return bindingDescriptor
    }

    const localFunction = env.file.localFunctions.get(node.text)
    if (localFunction) {
      return callableDescriptor(env.file.filePath, localFunction, captureClosureScope(scope))
    }

    const importedCallableDescriptor = env.importedCallableDescriptors.get(node.text)
    if (importedCallableDescriptor) {
      return cloneDescriptor(importedCallableDescriptor)
    }

    return null
  }

  if (isPropertyAccessLikeExpression(node)) {
    const parentDescriptor = resolveExpressionDescriptor(node.expression, scope, env)
    return parentDescriptor ? readPropertyDescriptor(parentDescriptor, node.name.text) : null
  }

  if (isElementAccessLikeExpression(node)) {
    const argument = node.argumentExpression ? unwrapExpression(node.argumentExpression) : null
    const propertyName = argument ? getStaticPropertyKey(argument) : null
    if (!propertyName) {
      return null
    }
    const parentDescriptor = resolveExpressionDescriptor(node.expression, scope, env)
    return parentDescriptor ? readPropertyDescriptor(parentDescriptor, propertyName) : null
  }

  if (isCallLikeExpression(node)) {
    return resolveCallDescriptor(node, scope, env)
  }

  if (ts.isObjectLiteralExpression(node)) {
    const properties: Record<string, Descriptor> = {}
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const propertyName = getLiteralPropertyName(property.name)
        if (!propertyName) {
          continue
        }
        const propertyDescriptor = resolveExpressionDescriptor(property.initializer, scope, env)
        if (propertyDescriptor) {
          properties[propertyName] = propertyDescriptor
        }
      }

      if (ts.isShorthandPropertyAssignment(property)) {
        const propertyDescriptor = resolveExpressionDescriptor(property.name, scope, env)
        if (propertyDescriptor) {
          properties[property.name.text] = propertyDescriptor
        }
      }
    }
    return Object.keys(properties).length > 0 ? objectDescriptor(properties) : null
  }

  if (ts.isConditionalExpression(node)) {
    const whenTrue = resolveExpressionDescriptor(node.whenTrue, scope, env)
    const whenFalse = resolveExpressionDescriptor(node.whenFalse, scope, env)
    return sameDescriptor(whenTrue, whenFalse) ? whenTrue : null
  }

  return null
}
