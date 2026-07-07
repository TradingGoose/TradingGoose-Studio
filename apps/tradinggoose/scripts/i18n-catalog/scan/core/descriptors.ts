import type { Descriptor, NamedFunctionNode, RequestedExports, Scope } from './types'

export function rootDescriptor(pathParts: string[]): Descriptor {
  return { kind: 'root', path: [...pathParts] }
}

export function translatorDescriptor(namespaceParts: string[]): Descriptor {
  return { kind: 'translator', namespace: [...namespaceParts] }
}

export function objectDescriptor(properties: Record<string, Descriptor>): Descriptor {
  return { kind: 'object', properties: { ...properties } }
}

export function callableDescriptor(
  filePath: string,
  targetNode: NamedFunctionNode,
  closureScope: Scope
): Descriptor {
  return { kind: 'callable', filePath, closureScope, targetNode }
}

export function cloneRequestedExports(requestedExports: RequestedExports): RequestedExports {
  return requestedExports === 'all' ? 'all' : new Set(requestedExports)
}

export function requestedExportsCover(
  current: RequestedExports | undefined,
  incoming: RequestedExports
): boolean {
  if (!current) {
    return false
  }

  if (current === 'all') {
    return true
  }

  if (incoming === 'all') {
    return false
  }

  for (const name of incoming) {
    if (!current.has(name)) {
      return false
    }
  }

  return true
}

export function mergeRequestedExports(
  current: RequestedExports | undefined,
  incoming: RequestedExports
): RequestedExports {
  if (!current) {
    return cloneRequestedExports(incoming)
  }

  if (current === 'all' || incoming === 'all') {
    return 'all'
  }

  const merged = new Set(current)
  for (const name of incoming) {
    merged.add(name)
  }
  return merged
}

export function requestedExportsForName(name: string): RequestedExports {
  return new Set([name])
}

export function cloneDescriptor(descriptor: Descriptor): Descriptor {
  if (descriptor.kind === 'root') {
    return rootDescriptor(descriptor.path)
  }

  if (descriptor.kind === 'translator') {
    return translatorDescriptor(descriptor.namespace)
  }

  if (descriptor.kind === 'callable') {
    return callableDescriptor(descriptor.filePath, descriptor.targetNode, descriptor.closureScope)
  }

  return objectDescriptor(
    Object.fromEntries(
      Object.entries(descriptor.properties).map(([key, value]) => [key, cloneDescriptor(value)])
    )
  )
}

export function sameDescriptor(left: Descriptor | null, right: Descriptor | null): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return left === right
  }

  if (left.kind === 'root' && right.kind === 'root') {
    return left.path.join('.') === right.path.join('.')
  }

  if (left.kind === 'translator' && right.kind === 'translator') {
    return left.namespace.join('.') === right.namespace.join('.')
  }

  if (left.kind === 'callable' && right.kind === 'callable') {
    return descriptorToPathKey(left) === descriptorToPathKey(right)
  }

  if (left.kind === 'object' && right.kind === 'object') {
    const leftKeys = Object.keys(left.properties)
    const rightKeys = Object.keys(right.properties)
    if (leftKeys.length !== rightKeys.length) {
      return false
    }

    return leftKeys.every((key) =>
      sameDescriptor(left.properties[key] ?? null, right.properties[key] ?? null)
    )
  }

  return false
}

export function descriptorToPathKey(descriptor: Descriptor): string {
  if (descriptor.kind === 'root') {
    return descriptor.path.join('.')
  }

  if (descriptor.kind === 'translator') {
    return descriptor.namespace.join('.')
  }

  if (descriptor.kind === 'callable') {
    return `callable:${descriptor.filePath}:${descriptor.targetNode.getStart(
      descriptor.targetNode.getSourceFile()
    )}`
  }

  return JSON.stringify(
    Object.fromEntries(
      Object.entries(descriptor.properties)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, descriptorToPathKey(value)])
    )
  )
}

export function descriptorMapKey(descriptors: Map<string, Descriptor> | undefined): string {
  if (!descriptors) {
    return ''
  }

  return [...descriptors.entries()]
    .map(([name, descriptor]) => `${name}:${descriptorToPathKey(descriptor)}`)
    .sort()
    .join('|')
}

export function descriptorMapsEqual(
  left: Map<string, Descriptor> | undefined,
  right: Map<string, Descriptor> | undefined
): boolean {
  return descriptorMapKey(left) === descriptorMapKey(right)
}

export function readPropertyDescriptor(
  descriptor: Descriptor,
  propertyName: string
): Descriptor | null {
  if (descriptor.kind === 'root') {
    return rootDescriptor([...descriptor.path, propertyName])
  }

  if (descriptor.kind === 'object') {
    return descriptor.properties[propertyName]
      ? cloneDescriptor(descriptor.properties[propertyName]!)
      : null
  }

  return null
}
