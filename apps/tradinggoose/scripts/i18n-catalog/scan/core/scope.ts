import ts from 'typescript'
import { cloneDescriptor, descriptorToPathKey } from './descriptors'
import { ROOT_HINT_NAME } from './rules'
import type { Descriptor, RootHint, Scope, TranslatorHint } from './types'

export function createRootScope(): Scope {
  const scope: Scope = {
    kind: 'root',
    parent: null,
    hoistTarget: null,
    bindings: new Map(),
    translatorHints: [],
    rootHints: [],
    currentFunction: null,
    inMetadata: false,
  }
  scope.hoistTarget = scope
  return scope
}

export function dedupeNullableStrings(values: Array<string | null>): Array<string | null> {
  const seen = new Set<string>()
  const deduped: Array<string | null> = []

  for (const value of values) {
    const key = value ?? '__null__'
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(value)
  }

  return deduped
}

export function createFunctionScope(parent: Scope, node: ts.FunctionLikeDeclaration): Scope {
  const scope: Scope = {
    kind: 'function',
    parent,
    hoistTarget: null,
    bindings: new Map(),
    translatorHints: [],
    rootHints: [],
    currentFunction: node,
    inMetadata:
      parent.inMetadata ||
      (ts.isFunctionDeclaration(node) && node.name?.text === 'generateMetadata'),
  }
  scope.hoistTarget = scope
  return scope
}

export function createBlockScope(parent: Scope, options?: { inMetadata?: boolean }): Scope {
  return {
    kind: 'block',
    parent,
    hoistTarget: parent.hoistTarget,
    bindings: new Map(),
    translatorHints: [],
    rootHints: [],
    currentFunction: parent.currentFunction,
    inMetadata: options?.inMetadata ?? parent.inMetadata,
  }
}

export function lookupBinding(scope: Scope, name: string): Descriptor | null {
  let current: Scope | null = scope
  while (current) {
    const descriptor = current.bindings.get(name)
    if (descriptor) {
      return cloneDescriptor(descriptor)
    }
    current = current.parent
  }
  return null
}

export function findTranslatorHint(
  scope: Scope,
  predicate: (hint: TranslatorHint) => boolean = () => true
): TranslatorHint | null {
  let current: Scope | null = scope
  while (current) {
    for (let index = current.translatorHints.length - 1; index >= 0; index -= 1) {
      const hint = current.translatorHints[index]!
      if (predicate(hint)) {
        return {
          name: hint.name,
          namespace: [...hint.namespace],
        }
      }
    }
    current = current.parent
  }
  return null
}

export function findRootHint(
  scope: Scope,
  predicate: (hint: RootHint) => boolean = () => true
): RootHint | null {
  let current: Scope | null = scope
  while (current) {
    for (let index = current.rootHints.length - 1; index >= 0; index -= 1) {
      const hint = current.rootHints[index]!
      if (predicate(hint)) {
        return {
          name: hint.name,
          path: [...hint.path],
        }
      }
    }
    current = current.parent
  }
  return null
}

export function isBlockScopedDeclarationList(node: ts.VariableDeclarationList): boolean {
  return (node.flags & ts.NodeFlags.BlockScoped) !== 0
}

export function bindVariableDeclaration(
  scope: Scope,
  node: ts.VariableDeclaration,
  descriptor: Descriptor
): void {
  const declarationList = ts.isVariableDeclarationList(node.parent) ? node.parent : null
  const targetScope =
    declarationList && !isBlockScopedDeclarationList(declarationList)
      ? (scope.hoistTarget ?? scope)
      : scope
  bindPattern(targetScope, node.name, descriptor)
}

export function captureClosureScope(scope: Scope): Scope {
  const closureScope = createRootScope()
  const seenNames = new Set<string>()
  let current: Scope | null = scope

  while (current) {
    for (const [name, descriptor] of current.bindings.entries()) {
      if (seenNames.has(name)) {
        continue
      }

      seenNames.add(name)
      closureScope.bindings.set(name, descriptor)
      addScopeHints(closureScope, name, descriptor)
    }

    current = current.parent
  }

  closureScope.inMetadata = scope.inMetadata
  return closureScope
}

export function bindPattern(
  scope: Scope,
  bindingName: ts.BindingName,
  descriptor: Descriptor
): void {
  if (ts.isIdentifier(bindingName)) {
    scope.bindings.set(bindingName.text, cloneDescriptor(descriptor))
    addScopeHints(scope, bindingName.text, descriptor)
    return
  }

  if (!ts.isObjectBindingPattern(bindingName) || descriptor.kind !== 'object') {
    return
  }

  for (const element of bindingName.elements) {
    if (element.dotDotDotToken) {
      continue
    }

    const propertyName =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : null
    if (!propertyName) {
      continue
    }

    const propertyDescriptor = descriptor.properties[propertyName]
    if (!propertyDescriptor) {
      continue
    }

    bindPattern(scope, element.name, propertyDescriptor)
  }
}

export function addScopeHints(scope: Scope, name: string, descriptor: Descriptor): void {
  if (descriptor.kind === 'translator' && descriptor.namespace.length > 0) {
    scope.translatorHints.push({ name, namespace: descriptor.namespace })
    return
  }

  if (descriptor.kind === 'root' && descriptor.path.length > 0 && ROOT_HINT_NAME.test(name)) {
    scope.rootHints.push({ name, path: descriptor.path })
  }
}

export function getScopeBindingSignature(scope: Scope | null): string {
  const entries: string[] = []
  const seenNames = new Set<string>()
  let current: Scope | null = scope

  while (current) {
    for (const [name, descriptor] of current.bindings.entries()) {
      if (seenNames.has(name)) {
        continue
      }

      seenNames.add(name)
      entries.push(`${name}:${descriptorToPathKey(descriptor)}`)
    }

    current = current.parent
  }

  return entries.sort().join('|')
}
