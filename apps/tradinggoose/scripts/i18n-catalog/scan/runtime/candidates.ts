import path from 'node:path'
import type ts from 'typescript'
import {
  isPathInsideDirectory,
  isRoutePathPrefix,
  resolveAppRoutePathForFile,
  resolveOwningRoutePathForFile,
} from '../../entries'
import {
  deriveComponentKeySegment,
  deriveRouteNamespace,
  getRouteOwnedNamespaces,
} from '../../ownership'
import { getNodeLocation } from '../core/ast'
import { findRootHint, findTranslatorHint } from '../core/scope'
import type {
  CoverageRecord,
  Descriptor,
  FileAnalysis,
  HardcodedCandidate,
  ProjectFile,
  ScanContext,
  ScanState,
  Scope,
} from '../core/types'

function isRouteAdjacentCandidateFile(
  filePath: string,
  activeRoutePath: string | null,
  context: ScanContext
): boolean {
  if (!activeRoutePath) {
    return false
  }

  if (!isPathInsideDirectory(filePath, context.entryDiscoveryContext.appRoot)) {
    return false
  }

  const owningRoutePath = resolveAppRoutePathForFile(context.entryDiscoveryContext, filePath)
  return Boolean(owningRoutePath && isRoutePathPrefix(owningRoutePath, activeRoutePath))
}

function resolveNamespaceHint(
  scope: Scope,
  filePath: string,
  context: ScanContext,
  metadata: boolean,
  activeRoutePath: string | null
): { namespace: string; source: HardcodedCandidate['namespaceSource'] } | null {
  const translatorHint = findTranslatorHint(scope, (hint) => hint.namespace.length > 0)
  if (translatorHint) {
    return {
      namespace: translatorHint.namespace.join('.'),
      source: 'static',
    }
  }

  const rootHint = findRootHint(scope, (hint) => hint.path.length > 0)
  if (rootHint) {
    return {
      namespace: rootHint.path.join('.'),
      source: 'static',
    }
  }

  const routePath =
    activeRoutePath ??
    context.routePath ??
    resolveOwningRoutePathForFile(context.entryDiscoveryContext, filePath)
  if (!routePath) {
    return null
  }

  const namespace = deriveRouteNamespace(routePath, { metadata })
  return {
    namespace,
    source:
      activeRoutePath === null && context.routePath === null
        ? 'ownership'
        : getRouteOwnedNamespaces(routePath).includes(namespace)
          ? 'ownership'
          : 'fallback',
  }
}

function isUiStringLiteral(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  if (!/[\p{L}\p{N}]/u.test(trimmed)) {
    return false
  }
  if (/^(https?:\/\/|mailto:|tel:|\/|#)/.test(trimmed)) {
    return false
  }
  if (/^[A-Z0-9_-]+$/.test(trimmed) && !/\s/.test(trimmed)) {
    return false
  }
  if (/^[a-z0-9_.-]+$/.test(trimmed) && !/\s/.test(trimmed)) {
    return false
  }
  return true
}

function slugifyCopyText(text: string): string {
  const words = text
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) {
    return 'copy'
  }

  const [firstWord, ...restWords] = words
  return [
    firstWord!.toLowerCase(),
    ...restWords.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()),
  ].join('')
}

export function captureExactCoverage(
  state: ScanState,
  file: ProjectFile,
  node: ts.Node,
  descriptor: Descriptor,
  source: CoverageRecord['source']
): void {
  if (descriptor.kind !== 'root' || descriptor.path.length === 0) {
    return
  }

  const location = getNodeLocation(file.sourceFile, node.getStart(file.sourceFile))
  state.coverage.push({
    filePath: file.filePath,
    line: location.line,
    column: location.column,
    path: descriptor.path,
    pathKey: descriptor.path.join('.'),
    mode: 'exact',
    source,
  })
}

export function captureSubtreeCoverage(
  state: ScanState,
  file: ProjectFile,
  node: ts.Node,
  descriptor: Descriptor,
  source: CoverageRecord['source'],
  subtreeReason: NonNullable<CoverageRecord['subtreeReason']>
): void {
  if (descriptor.kind !== 'root' && descriptor.kind !== 'translator') {
    return
  }

  const pathParts = descriptor.kind === 'root' ? descriptor.path : descriptor.namespace
  if (pathParts.length === 0) {
    return
  }

  const location = getNodeLocation(file.sourceFile, node.getStart(file.sourceFile))
  state.coverage.push({
    filePath: file.filePath,
    line: location.line,
    column: location.column,
    path: pathParts,
    pathKey: pathParts.join('.'),
    mode: 'subtree',
    source,
    subtreeReason,
  })
}

export function captureHardcodedCandidate(
  state: ScanState,
  context: ScanContext,
  analysis: FileAnalysis,
  activeScope: Scope,
  node: ts.Node,
  text: string,
  options: { kind: HardcodedCandidate['kind']; attributeName?: string; metadata?: boolean },
  activeRoutePath: string | null
): void {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  if (!isUiStringLiteral(normalizedText)) {
    return
  }

  const namespaceHint = resolveNamespaceHint(
    activeScope,
    analysis.file.filePath,
    context,
    Boolean(options.metadata),
    activeRoutePath
  )
  if (!namespaceHint) {
    return
  }

  const { namespace, source } = namespaceHint
  if (
    source !== 'static' &&
    !isRouteAdjacentCandidateFile(analysis.file.filePath, activeRoutePath, context)
  ) {
    return
  }

  const componentSegment = deriveComponentKeySegment(analysis.file.filePath, context.projectRoot)
  const fileBasename = path.basename(analysis.file.filePath, path.extname(analysis.file.filePath))
  const namespaceTerminalSegment = namespace.split('.').filter(Boolean).at(-1) ?? ''
  const shouldSuppressComponentSegment =
    source !== 'static' &&
    (fileBasename === 'page' || fileBasename === 'layout' || fileBasename === 'index') &&
    componentSegment === namespaceTerminalSegment
  const relativeKeyParts =
    source === 'static'
      ? [slugifyCopyText(normalizedText)]
      : shouldSuppressComponentSegment
        ? [slugifyCopyText(normalizedText)]
        : [componentSegment, slugifyCopyText(normalizedText)]
  const location = getNodeLocation(
    analysis.file.sourceFile,
    node.getStart(analysis.file.sourceFile)
  )

  state.hardcodedCandidates.push({
    filePath: analysis.file.filePath,
    line: location.line,
    column: location.column,
    text: normalizedText,
    kind: options.kind,
    namespace,
    namespaceSource: source,
    relativeKeyParts,
    attributeName: options.attributeName,
    metadata: Boolean(options.metadata),
  })
}

export function dedupeHardcodedCandidates(candidates: HardcodedCandidate[]): HardcodedCandidate[] {
  const deduped: HardcodedCandidate[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const key = [
      candidate.filePath,
      candidate.line,
      candidate.column,
      candidate.text,
      candidate.namespace,
      candidate.kind,
      candidate.attributeName ?? '',
      candidate.metadata ? '1' : '0',
    ].join(':')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(candidate)
  }

  return deduped
}
