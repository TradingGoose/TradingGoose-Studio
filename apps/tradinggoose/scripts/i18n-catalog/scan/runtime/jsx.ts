import ts from 'typescript'
import { getLiteralPropertyName, getStaticTextValue, unwrapExpression } from '../core/ast'
import { HARD_CODED_PROP_NAMES, METADATA_PROP_NAMES } from '../core/rules'
import type { ArgumentDescriptor, CallableTarget, Scope, WalkEnv } from '../core/types'
import { captureHardcodedCandidate } from './candidates'
import {
  buildJsxPropsDescriptor,
  isIntrinsicJsxTagName,
  resolveCallableTargetFromExpression,
  resolveCallableTargetFromJsx,
} from './targets'

type InvocationScanner = (target: CallableTarget, argumentDescriptors: ArgumentDescriptor[]) => void

export function handleJsxText(node: ts.Node, scope: Scope, env: WalkEnv): void {
  if (!ts.isJsxText(node)) {
    return
  }

  captureHardcodedCandidate(
    env.state,
    env.context,
    env.analysis,
    scope,
    node,
    node.getText(env.analysis.file.sourceFile),
    {
      kind: 'jsx-text',
    },
    env.activeRoutePath
  )
}

export function handleJsxComponentInvocation(
  node: ts.Node,
  scope: Scope,
  env: WalkEnv,
  scanInvocation: InvocationScanner
): void {
  if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) {
    return
  }

  const propsDescriptor = buildJsxPropsDescriptor(node.attributes, env.analysis, scope)
  const target = resolveCallableTargetFromJsx(
    node.tagName,
    env.analysis,
    scope,
    env.context,
    env.activeRoutePath
  )
  if (target) {
    scanInvocation(target, propsDescriptor ? [{ index: 0, descriptor: propsDescriptor }] : [])
  }
}

export function handleLiteralJsxAttribute(node: ts.Node, scope: Scope, env: WalkEnv): void {
  if (
    !ts.isJsxAttribute(node) ||
    !node.initializer ||
    !ts.isStringLiteral(node.initializer) ||
    !ts.isIdentifier(node.name) ||
    !HARD_CODED_PROP_NAMES.has(node.name.text)
  ) {
    return
  }

  captureHardcodedCandidate(
    env.state,
    env.context,
    env.analysis,
    scope,
    node.initializer,
    node.initializer.text,
    {
      kind: 'jsx-attribute',
      attributeName: node.name.text,
    },
    env.activeRoutePath
  )
}

export function handleIntrinsicJsxEventAttribute(
  node: ts.Node,
  scope: Scope,
  env: WalkEnv,
  scanInvocation: InvocationScanner
): void {
  if (
    !ts.isJsxAttribute(node) ||
    !ts.isIdentifier(node.name) ||
    !/^on[A-Z]/.test(node.name.text) ||
    !node.initializer ||
    !ts.isJsxExpression(node.initializer) ||
    !node.initializer.expression ||
    (!ts.isJsxOpeningElement(node.parent.parent) &&
      !ts.isJsxSelfClosingElement(node.parent.parent)) ||
    !isIntrinsicJsxTagName(node.parent.parent.tagName)
  ) {
    return
  }

  const target = resolveCallableTargetFromExpression(
    node.initializer.expression,
    env.analysis,
    scope,
    env.context,
    env.activeRoutePath
  )
  if (target) {
    scanInvocation(target, [])
  }
}

export function handleMetadataProperty(node: ts.Node, scope: Scope, env: WalkEnv): void {
  if (
    !scope.inMetadata ||
    !ts.isPropertyAssignment(node) ||
    !node.initializer ||
    !METADATA_PROP_NAMES.has(getLiteralPropertyName(node.name) ?? '')
  ) {
    return
  }

  const staticText = getStaticTextValue(unwrapExpression(node.initializer))
  if (staticText) {
    captureHardcodedCandidate(
      env.state,
      env.context,
      env.analysis,
      scope,
      node.initializer,
      staticText,
      {
        kind: 'metadata',
        attributeName: getLiteralPropertyName(node.name) ?? undefined,
        metadata: true,
      },
      env.activeRoutePath
    )
  }
}
