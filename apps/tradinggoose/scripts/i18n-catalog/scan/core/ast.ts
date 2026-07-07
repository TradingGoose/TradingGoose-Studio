import ts from 'typescript'
import type { NamedFunctionNode } from './types'

export function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) {
    return [name.text]
  }

  const bindingNames: string[] = []
  for (const element of name.elements) {
    if (!ts.isBindingElement(element)) {
      continue
    }
    bindingNames.push(...collectBindingNames(element.name))
  }
  return bindingNames
}

export function getLiteralPropertyName(
  name: ts.PropertyName | ts.BindingName | undefined
): string | null {
  if (!name) {
    return null
  }

  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text
  }

  if (ts.isComputedPropertyName(name)) {
    return getStaticPropertyKey(name.expression)
  }

  return null
}

export function getStaticTextValue(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return null
}

export function getStaticPropertyKey(node: ts.Expression): string | null {
  if (ts.isNumericLiteral(node)) {
    return node.text
  }

  return getStaticTextValue(node)
}

export function getTypeLiteralPropertyKey(node: ts.TypeNode): string | null {
  if (!ts.isLiteralTypeNode(node)) {
    return null
  }

  if (ts.isStringLiteral(node.literal) || ts.isNumericLiteral(node.literal)) {
    return node.literal.text
  }

  return null
}

export function unwrapExpression(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression)
  }

  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return unwrapExpression(node.expression)
  }

  if (ts.isSatisfiesExpression(node)) {
    return unwrapExpression(node.expression)
  }

  if (ts.isAwaitExpression(node)) {
    return unwrapExpression(node.expression)
  }

  return node
}

export function getScriptKind(filePath: string): ts.ScriptKind {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

export function extractCallableInitializer(expression: ts.Expression): NamedFunctionNode | null {
  const node = unwrapExpression(expression)
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node
  }

  if (!ts.isCallExpression(node) && !ts.isCallChain(node)) {
    return null
  }

  const callee = unwrapExpression(node.expression)
  let calleeName: string | null = null
  if (ts.isIdentifier(callee)) {
    calleeName = callee.text
  } else if (ts.isPropertyAccessExpression(callee) || ts.isPropertyAccessChain(callee)) {
    calleeName = callee.name.text
  } else if (
    (ts.isElementAccessExpression(callee) || ts.isElementAccessChain(callee)) &&
    callee.argumentExpression
  ) {
    calleeName = getStaticPropertyKey(unwrapExpression(callee.argumentExpression))
  }

  if (calleeName !== 'useCallback') {
    return null
  }

  const callback = node.arguments[0] ? unwrapExpression(node.arguments[0]!) : null
  if (!callback) {
    return null
  }

  return ts.isArrowFunction(callback) || ts.isFunctionExpression(callback) ? callback : null
}

export function isPropertyAccessLikeExpression(
  node: ts.Node
): node is ts.PropertyAccessExpression | ts.PropertyAccessChain {
  return ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)
}

export function isElementAccessLikeExpression(
  node: ts.Node
): node is ts.ElementAccessExpression | ts.ElementAccessChain {
  return ts.isElementAccessExpression(node) || ts.isElementAccessChain(node)
}

export function isCallLikeExpression(node: ts.Node): node is ts.CallExpression | ts.CallChain {
  return ts.isCallExpression(node) || ts.isCallChain(node)
}

export function getAccessedPropertyName(
  node:
    | ts.PropertyAccessExpression
    | ts.PropertyAccessChain
    | ts.ElementAccessExpression
    | ts.ElementAccessChain
): string | null {
  if (isPropertyAccessLikeExpression(node)) {
    return node.name.text
  }

  const argument = node.argumentExpression ? unwrapExpression(node.argumentExpression) : null
  return argument ? getStaticPropertyKey(argument) : null
}

export function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  )
}

export function isNestedLocalFunction(node: NamedFunctionNode): boolean {
  let current: ts.Node | undefined = node.parent

  while (current) {
    if (ts.isSourceFile(current)) {
      return false
    }

    if (isFunctionLike(current)) {
      return true
    }

    current = current.parent
  }

  return false
}

export function getNodeLocation(
  sourceFile: ts.SourceFile,
  position: number
): {
  line: number
  column: number
} {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position)
  return { line: line + 1, column: character + 1 }
}
