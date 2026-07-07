import ts from 'typescript'
import { getLiteralPropertyName, getTypeLiteralPropertyKey } from '../core/ast'
import { cloneDescriptor, objectDescriptor, readPropertyDescriptor } from '../core/descriptors'
import type { Descriptor, FileSemantics, ProjectFile, TypeDeclarationNode } from '../core/types'

function resolveNamedTypeDescriptor(
  nameNode: ts.EntityName | ts.Expression,
  availableTypes: Map<string, Descriptor>
): Descriptor | null {
  if (!ts.isIdentifier(nameNode)) {
    return null
  }

  const descriptor = availableTypes.get(nameNode.text)
  return descriptor ? cloneDescriptor(descriptor) : null
}

export function resolveStructuralTypeDescriptor(
  node: ts.TypeNode | TypeDeclarationNode | ts.ExpressionWithTypeArguments | undefined,
  availableTypes: Map<string, Descriptor>
): Descriptor | null {
  if (!node) {
    return null
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return resolveStructuralTypeDescriptor(node.type, availableTypes)
  }

  if (ts.isInterfaceDeclaration(node)) {
    const properties: Record<string, Descriptor> = {}
    let resolvedAny = false

    for (const heritageClause of node.heritageClauses ?? []) {
      if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
        continue
      }

      for (const typeNode of heritageClause.types) {
        const baseDescriptor = resolveStructuralTypeDescriptor(typeNode, availableTypes)
        if (baseDescriptor?.kind !== 'object') {
          continue
        }

        resolvedAny = true
        for (const [propertyName, propertyDescriptor] of Object.entries(
          baseDescriptor.properties
        )) {
          properties[propertyName] = cloneDescriptor(propertyDescriptor)
        }
      }
    }

    for (const member of node.members) {
      if (
        !ts.isPropertySignature(member) ||
        !member.type ||
        ts.isComputedPropertyName(member.name)
      ) {
        continue
      }

      const propertyName = getLiteralPropertyName(member.name)
      if (!propertyName) {
        continue
      }

      const propertyDescriptor = resolveStructuralTypeDescriptor(member.type, availableTypes)
      if (!propertyDescriptor) {
        continue
      }

      properties[propertyName] = propertyDescriptor
      resolvedAny = true
    }

    return resolvedAny ? objectDescriptor(properties) : null
  }

  if (ts.isExpressionWithTypeArguments(node)) {
    return resolveNamedTypeDescriptor(node.expression, availableTypes)
  }

  if (ts.isTypeReferenceNode(node)) {
    return resolveNamedTypeDescriptor(node.typeName, availableTypes)
  }

  if (ts.isIndexedAccessTypeNode(node)) {
    const objectTypeDescriptor = resolveStructuralTypeDescriptor(node.objectType, availableTypes)
    const indexType = node.indexType
    if (
      !objectTypeDescriptor ||
      !ts.isLiteralTypeNode(indexType) ||
      !ts.isStringLiteral(indexType.literal)
    ) {
      return null
    }
    return readPropertyDescriptor(objectTypeDescriptor, indexType.literal.text)
  }

  if (ts.isTypeLiteralNode(node)) {
    const properties: Record<string, Descriptor> = {}
    let resolvedAny = false

    for (const member of node.members) {
      if (
        !ts.isPropertySignature(member) ||
        !member.type ||
        ts.isComputedPropertyName(member.name)
      ) {
        continue
      }

      const propertyName = getLiteralPropertyName(member.name)
      if (!propertyName) {
        continue
      }

      const propertyDescriptor = resolveStructuralTypeDescriptor(member.type, availableTypes)
      if (!propertyDescriptor) {
        continue
      }

      properties[propertyName] = propertyDescriptor
      resolvedAny = true
    }

    return resolvedAny ? objectDescriptor(properties) : null
  }

  return null
}

function resolveTypeQueryDescriptor(
  node: ts.TypeQueryNode,
  _file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>
): Descriptor | null {
  if (!ts.isIdentifier(node.exprName)) {
    return null
  }

  const localDescriptor = localSemantics.get(node.exprName.text)
  if (localDescriptor) {
    return cloneDescriptor(localDescriptor)
  }

  const importedDescriptor = importedSemantics.get(node.exprName.text)
  return importedDescriptor ? cloneDescriptor(importedDescriptor) : null
}

function resolveInterfaceDescriptor(
  node: ts.InterfaceDeclaration,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes: Set<string>
): Descriptor | null {
  const properties: Record<string, Descriptor> = {}
  let resolvedAny = false

  for (const heritageClause of node.heritageClauses ?? []) {
    if (heritageClause.token !== ts.SyntaxKind.ExtendsKeyword) {
      continue
    }

    for (const typeNode of heritageClause.types) {
      const baseDescriptor = resolveTypeDescriptor(
        typeNode,
        file,
        localSemantics,
        importedSemantics,
        seenTypes
      )
      if (baseDescriptor?.kind !== 'object') {
        continue
      }

      resolvedAny = true
      for (const [propertyName, propertyDescriptor] of Object.entries(baseDescriptor.properties)) {
        properties[propertyName] = cloneDescriptor(propertyDescriptor)
      }
    }
  }

  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type || ts.isComputedPropertyName(member.name)) {
      continue
    }

    const propertyName = getLiteralPropertyName(member.name)
    if (!propertyName) {
      continue
    }

    const propertyDescriptor = resolveTypeDescriptor(
      member.type,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    if (!propertyDescriptor) {
      continue
    }

    properties[propertyName] = propertyDescriptor
    resolvedAny = true
  }

  return resolvedAny ? objectDescriptor(properties) : null
}

function resolveTypeLiteralDescriptor(
  node: ts.TypeLiteralNode,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes: Set<string>
): Descriptor | null {
  const properties: Record<string, Descriptor> = {}
  let resolvedAny = false

  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type || ts.isComputedPropertyName(member.name)) {
      continue
    }

    const propertyName = getLiteralPropertyName(member.name)
    if (!propertyName) {
      continue
    }

    const propertyDescriptor = resolveTypeDescriptor(
      member.type,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    if (!propertyDescriptor) {
      continue
    }

    properties[propertyName] = propertyDescriptor
    resolvedAny = true
  }

  return resolvedAny ? objectDescriptor(properties) : null
}

function resolveLocalTypeDeclarationDescriptor(
  name: string,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes: Set<string>
): Descriptor | null {
  const declaration = file.localTypeDeclarations.get(name)
  if (!declaration) {
    return null
  }

  const typeKey = `${file.filePath}:${name}`
  if (seenTypes.has(typeKey)) {
    return null
  }

  seenTypes.add(typeKey)
  const descriptor = resolveTypeDescriptor(
    declaration,
    file,
    localSemantics,
    importedSemantics,
    seenTypes
  )
  seenTypes.delete(typeKey)
  return descriptor
}

export function resolveTypeDescriptor(
  typeNode: ts.TypeNode | TypeDeclarationNode | ts.ExpressionWithTypeArguments | undefined,
  file: ProjectFile,
  localSemantics: FileSemantics,
  importedSemantics: Map<string, Descriptor>,
  seenTypes = new Set<string>()
): Descriptor | null {
  if (!typeNode) {
    return null
  }

  if (ts.isTypeAliasDeclaration(typeNode)) {
    return resolveTypeDescriptor(typeNode.type, file, localSemantics, importedSemantics, seenTypes)
  }

  if (ts.isInterfaceDeclaration(typeNode)) {
    return resolveInterfaceDescriptor(typeNode, file, localSemantics, importedSemantics, seenTypes)
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return resolveTypeDescriptor(typeNode.type, file, localSemantics, importedSemantics, seenTypes)
  }

  if (ts.isTypeQueryNode(typeNode)) {
    return resolveTypeQueryDescriptor(typeNode, file, localSemantics, importedSemantics)
  }

  if (ts.isExpressionWithTypeArguments(typeNode)) {
    if (!ts.isIdentifier(typeNode.expression)) {
      return null
    }

    const localDescriptor = resolveLocalTypeDeclarationDescriptor(
      typeNode.expression.text,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    if (localDescriptor) {
      return localDescriptor
    }
  }

  if (ts.isTypeReferenceNode(typeNode)) {
    if (
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeName.text === 'ReturnType' &&
      typeNode.typeArguments?.length === 1
    ) {
      const [typeArgument] = typeNode.typeArguments
      if (typeArgument && ts.isTypeQueryNode(typeArgument)) {
        return resolveTypeQueryDescriptor(typeArgument, file, localSemantics, importedSemantics)
      }
    }

    if (ts.isIdentifier(typeNode.typeName)) {
      const localDescriptor = resolveLocalTypeDeclarationDescriptor(
        typeNode.typeName.text,
        file,
        localSemantics,
        importedSemantics,
        seenTypes
      )
      if (localDescriptor) {
        return localDescriptor
      }
    }
  }

  if (ts.isIndexedAccessTypeNode(typeNode)) {
    const objectTypeDescriptor = resolveTypeDescriptor(
      typeNode.objectType,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
    const propertyKey = getTypeLiteralPropertyKey(typeNode.indexType)

    if (!objectTypeDescriptor || !propertyKey) {
      return null
    }

    return readPropertyDescriptor(objectTypeDescriptor, propertyKey)
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    return resolveTypeLiteralDescriptor(
      typeNode,
      file,
      localSemantics,
      importedSemantics,
      seenTypes
    )
  }

  return resolveStructuralTypeDescriptor(typeNode, file.typeRoots)
}
