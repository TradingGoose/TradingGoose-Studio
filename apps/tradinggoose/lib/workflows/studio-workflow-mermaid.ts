import type { Edge } from '@xyflow/react'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'
import { inferMermaidDirectionFromWorkflowState } from '@/lib/workflows/workflow-direction'
import type { BlockState, Loop, Parallel, WorkflowDirection } from '@/stores/workflows/workflow/types'

export { TG_MERMAID_DOCUMENT_FORMAT } from '@/lib/workflows/document-format'

type WorkflowDocumentMetadata = {
  version: typeof TG_MERMAID_DOCUMENT_FORMAT
  direction: WorkflowDirection
  lastSaved?: string
  isDeployed?: boolean
  deployedAt?: string
}

type ConditionEntry = {
  key: string
  value: string
}

type MermaidLabelOverlay = {
  id: string
  name: string
  type?: string
  enabled?: boolean
  advancedMode?: boolean
  triggerMode?: boolean
  outputs?: Record<string, unknown>
  dataEntries: Record<string, unknown>
  subBlockEntries: Record<string, unknown>
}

type ConditionBranchOverlay = {
  blockId: string
  key: string
  value: string
}

type ParsedMermaidLabelOverlays = {
  blocks: Map<string, MermaidLabelOverlay>
  conditionBranches: Map<string, ConditionEntry[]>
}

type VisibleNodeRef =
  | { kind: 'block'; blockId: string }
  | { kind: 'condition-branch'; blockId: string; sourceHandle: string }
  | { kind: 'container-start'; blockId: string; blockType: 'loop' | 'parallel' }
  | { kind: 'container-end'; blockId: string; blockType: 'loop' | 'parallel' }

type ParsedVisibleWorkflowEdges = {
  edges: Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>
  preferredBlockNodeIds: Map<string, string>
  visibleBlockIds: Set<string>
  inferredParentIds: Map<string, string>
}

const COMMENT_PREFIX = '%% '
export const TG_WORKFLOW_PREFIX = `${COMMENT_PREFIX}TG_WORKFLOW `
export const TG_BLOCK_PREFIX = `${COMMENT_PREFIX}TG_BLOCK `
export const TG_EDGE_PREFIX = `${COMMENT_PREFIX}TG_EDGE `
const TG_LOOP_PREFIX = `${COMMENT_PREFIX}TG_LOOP `
const TG_PARALLEL_PREFIX = `${COMMENT_PREFIX}TG_PARALLEL `
const CONDITION_INPUT_KEY = 'conditions'

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = sortJsonValue((value as Record<string, unknown>)[key])
        return sorted
      }, {})
  }

  return value
}

function toDocumentJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function toCommentLine(prefix: string, value: unknown): string {
  return `${prefix}${toDocumentJson(value)}`
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '<br/>')
}

function unescapeMermaidLabel(value: string): string {
  return value.replace(/<br\/>/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

function buildAliasMap(blockIds: string[]): Map<string, string> {
  return new Map(blockIds.map((blockId, index) => [blockId, `n${index + 1}`]))
}

function resolveBlockIdFromVisibleNodeId(
  nodeId: string,
  knownBlockIds: Set<string>,
  aliasToBlockId: Map<string, string>
): string | undefined {
  return aliasToBlockId.get(nodeId) ?? (knownBlockIds.has(nodeId) ? nodeId : undefined)
}

function parseRectNodeLine(
  line: string
): { nodeId: string; label: string } | null {
  const rectMatch = line.match(/^([A-Za-z0-9_]+)(?:\(\["(.*)"\]\)|\["(.*)"\])$/)
  const label = rectMatch?.[2] ?? rectMatch?.[3]

  if (!rectMatch?.[1] || !label) {
    return null
  }

  return {
    nodeId: rectMatch[1],
    label,
  }
}

function getChildrenByParent(blocks: Record<string, BlockState>): Map<string, string[]> {
  const childrenByParent = new Map<string, string[]>()

  for (const [blockId, block] of Object.entries(blocks)) {
    const parentId = block.data?.parentId
    if (!parentId || !blocks[parentId]) {
      continue
    }

    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(blockId)
    childrenByParent.set(parentId, siblings)
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.localeCompare(right))
  }

  return childrenByParent
}

function parseConditionEntries(value: unknown): ConditionEntry[] {
  const normalizeKey = (rawKey: string, nextElseIfIndexRef: { current: number }): string => {
    const trimmed = rawKey.trim()
    if (trimmed === 'else if') {
      nextElseIfIndexRef.current += 1
      return nextElseIfIndexRef.current === 1
        ? 'else-if'
        : `else-if-${nextElseIfIndexRef.current}`
    }
    return trimmed
  }

  const getOrder = (key: string): number => {
    if (key === 'if') return 0
    if (key === 'else-if') return 1
    if (key.startsWith('else-if-')) {
      const suffix = Number.parseInt(key.replace('else-if-', ''), 10)
      return Number.isNaN(suffix) ? 500 : 1 + suffix
    }
    if (key === 'else') return 1000
    return 500
  }

  const entries: ConditionEntry[] = []

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parseConditionEntries(parsed)
    } catch {
      return entries
    }
  }

  if (Array.isArray(value)) {
    const elseIfIndexRef = { current: 0 }

    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue
      }

      const condition = item as { title?: string; value?: unknown }
      if (typeof condition.title !== 'string' || condition.value === undefined) {
        continue
      }

      const nextKey = normalizeKey(condition.title, elseIfIndexRef)
      const nextValue = String(condition.value ?? '').trim()
      entries.push({ key: nextKey, value: nextValue })
    }
  } else if (value && typeof value === 'object') {
    entries.push(
      ...Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({
        key,
        value: String(entryValue ?? '').trim(),
      }))
    )
  }

  return entries
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => getOrder(left.key) - getOrder(right.key))
}

function buildConditionStoredValue(blockId: string, entries: ConditionEntry[]): string {
  const normalized = [...entries].sort((left, right) => {
    const getOrder = (key: string): number => {
      if (key === 'if') return 0
      if (key === 'else-if') return 1
      if (key.startsWith('else-if-')) {
        const suffix = Number.parseInt(key.replace('else-if-', ''), 10)
        return Number.isNaN(suffix) ? 500 : 1 + suffix
      }
      if (key === 'else') return 1000
      return 500
    }

    return getOrder(left.key) - getOrder(right.key)
  })

  const arrayPayload = normalized.map((entry) => ({
    id: `${blockId}-${entry.key}`,
    title: entry.key.startsWith('else-if') ? 'else if' : entry.key,
    value: entry.value,
    showTags: false,
    showEnvVars: false,
    searchTerm: '',
    cursorPosition: 0,
    activeSourceBlockId: null,
  }))

  if (!normalized.some((entry) => entry.key === 'else')) {
    arrayPayload.push({
      id: `${blockId}-else`,
      title: 'else',
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    })
  }

  return JSON.stringify(arrayPayload)
}

function serializeLabelValue(value: unknown): string {
  if (typeof value === 'string') {
    if (value.includes('\n') || value.includes('"')) {
      return JSON.stringify(value)
    }
    return value
  }

  return toDocumentJson(value)
}

function parseLabelValue(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ''
  }

  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed)
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }

  return trimmed
}

function buildBlockLabelLines(blockId: string, block: BlockState): string[] {
  const lines = [block.name, `id: ${blockId}`, `type: ${block.type}`, `enabled: ${block.enabled}`]

  if (block.advancedMode !== undefined) {
    lines.push(`advancedMode: ${block.advancedMode}`)
  }
  if (block.triggerMode !== undefined) {
    lines.push(`triggerMode: ${block.triggerMode}`)
  }

  const conditionEntries =
    block.type === 'condition'
      ? parseConditionEntries(block.subBlocks?.[CONDITION_INPUT_KEY]?.value)
      : []

  const subBlockKeys = Object.keys(block.subBlocks || {}).sort((left, right) => left.localeCompare(right))
  for (const subBlockKey of subBlockKeys) {
    if (subBlockKey === CONDITION_INPUT_KEY && conditionEntries.length > 0) {
      continue
    }

    const subBlock = block.subBlocks[subBlockKey]
    if (!subBlock || subBlock.value === null || subBlock.value === undefined) {
      continue
    }

    lines.push(`subBlocks.${subBlockKey}: ${serializeLabelValue(subBlock.value)}`)
  }

  const dataEntries = Object.entries(block.data || {})
    .filter(([key, value]) => value !== undefined && !['parentId', 'extent', 'width', 'height', 'type'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
  for (const [key, value] of dataEntries) {
    lines.push(`data.${key}: ${serializeLabelValue(value)}`)
  }

  if (block.outputs && Object.keys(block.outputs).length > 0) {
    lines.push(`outputs: ${toDocumentJson(block.outputs)}`)
  }

  return lines
}

function renderRectNode(nodeId: string, labelLines: string[], indent: string): string {
  return `${indent}${nodeId}["${escapeMermaidLabel(labelLines.join('\n'))}"]`
}

function renderDiamondNode(nodeId: string, labelLines: string[], indent: string): string {
  return `${indent}${nodeId}{"${escapeMermaidLabel(labelLines.join('\n'))}"}`
}

function createContainerNodeId(alias: string, type: 'loop' | 'parallel', kind: 'start' | 'end'): string {
  return `${alias}__${type}_${kind}`
}

function createConditionBranchNodeId(alias: string, key: string): string {
  return `${alias}__condition_${key.replace(/[^A-Za-z0-9_]/g, '_')}`
}

function buildConditionHandleId(blockId: string, key: string): string {
  return `condition-${blockId}-${key}`
}

function buildStableEdgeId(
  edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>
): string {
  const sourceHandle =
    !edge.sourceHandle || edge.sourceHandle === 'source' || edge.sourceHandle === 'output'
      ? 'source'
      : edge.sourceHandle
  const targetHandle =
    !edge.targetHandle || edge.targetHandle === 'target' || edge.targetHandle === 'input'
      ? 'target'
      : edge.targetHandle

  return `${edge.source}-${sourceHandle}-${edge.target}-${targetHandle}`
}

function buildConditionBranchLabelLines(blockId: string, entry: ConditionEntry): string[] {
  const lines = [entry.key, `id: ${buildConditionHandleId(blockId, entry.key)}`]
  if (entry.value.trim().length > 0) {
    lines.push(`value: ${entry.value}`)
  }
  return lines
}

function emitBlockGraphLines(params: {
  blockId: string
  blocks: Record<string, BlockState>
  aliases: Map<string, string>
  childrenByParent: Map<string, string[]>
  lines: string[]
  indent?: string
}): void {
  const { blockId, blocks, aliases, childrenByParent, lines, indent = '  ' } = params
  const block = blocks[blockId]
  const alias = aliases.get(blockId)

  if (!block || !alias) {
    return
  }

  const labelLines = buildBlockLabelLines(blockId, block)
  const children = childrenByParent.get(blockId) ?? []

  if (block.type === 'condition') {
    const conditionEntries = parseConditionEntries(block.subBlocks?.[CONDITION_INPUT_KEY]?.value)

    lines.push(`${indent}subgraph sg_${alias}["${escapeMermaidLabel(labelLines.join('\n'))}"]`)
    lines.push(renderDiamondNode(alias, [block.name], `${indent}  `))

    for (const entry of conditionEntries) {
      const branchNodeId = createConditionBranchNodeId(alias, entry.key)
      lines.push(
        renderRectNode(
          branchNodeId,
          buildConditionBranchLabelLines(blockId, entry),
          `${indent}  `
        )
      )
      lines.push(`${indent}  ${alias} --> ${branchNodeId}`)
    }

    lines.push(`${indent}end`)
    return
  }

  if (children.length === 0 || (block.type !== 'loop' && block.type !== 'parallel')) {
    lines.push(renderRectNode(alias, labelLines, indent))
    return
  }

  lines.push(`${indent}subgraph sg_${alias}["${escapeMermaidLabel(labelLines.join('\n'))}"]`)
  lines.push(
    renderRectNode(
      createContainerNodeId(alias, block.type, 'start'),
      [block.type === 'loop' ? 'Loop Start' : 'Parallel Start'],
      `${indent}  `
    )
  )
  for (const childId of children) {
    emitBlockGraphLines({
      blockId: childId,
      blocks,
      aliases,
      childrenByParent,
      lines,
      indent: `${indent}  `,
    })
  }
  lines.push(
    renderRectNode(
      createContainerNodeId(alias, block.type, 'end'),
      [block.type === 'loop' ? 'Loop End' : 'Parallel End'],
      `${indent}  `
    )
  )
  lines.push(`${indent}end`)
}

function extractConditionDisplayKey(blockId: string, sourceHandle: string | null | undefined): string | null {
  if (!sourceHandle || !sourceHandle.startsWith('condition-')) {
    return null
  }

  const exactPrefix = `condition-${blockId}-`
  if (sourceHandle.startsWith(exactPrefix)) {
    return sourceHandle.slice(exactPrefix.length)
  }

  const withoutPrefix = sourceHandle.slice('condition-'.length)
  if (withoutPrefix.endsWith('-else')) {
    return 'else'
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i
  const match = withoutPrefix.match(uuidRegex)
  if (match?.[1]) {
    return match[1]
  }

  return withoutPrefix
}

function resolveVisibleSourceNodeId(
  edge: Edge,
  blocks: Record<string, BlockState>,
  preferredBlockNodeIds: Map<string, string>,
  aliases: Map<string, string>
): string | null {
  const sourceAlias = preferredBlockNodeIds.get(edge.source) ?? aliases.get(edge.source)
  const sourceBlock = blocks[edge.source]

  if (!sourceAlias || !sourceBlock) {
    return sourceAlias ?? null
  }

  if (sourceBlock.type === 'loop') {
    if (edge.sourceHandle === 'loop-start-source') {
      return createContainerNodeId(sourceAlias, 'loop', 'start')
    }
    if (edge.sourceHandle === 'loop-end-source') {
      return createContainerNodeId(sourceAlias, 'loop', 'end')
    }
  }

  if (sourceBlock.type === 'parallel') {
    if (edge.sourceHandle === 'parallel-start-source') {
      return createContainerNodeId(sourceAlias, 'parallel', 'start')
    }
    if (edge.sourceHandle === 'parallel-end-source') {
      return createContainerNodeId(sourceAlias, 'parallel', 'end')
    }
  }

  if (sourceBlock.type === 'condition') {
    const semanticCondition = extractConditionDisplayKey(sourceBlock.id, edge.sourceHandle)
    if (semanticCondition) {
      return createConditionBranchNodeId(sourceAlias, semanticCondition)
    }
  }

  return sourceAlias
}

function resolveVisibleTargetNodeId(
  edge: Edge,
  blocks: Record<string, BlockState>,
  preferredBlockNodeIds: Map<string, string>,
  aliases: Map<string, string>
): string | null {
  const targetAlias = preferredBlockNodeIds.get(edge.target) ?? aliases.get(edge.target)
  const targetBlock = blocks[edge.target]

  if (!targetAlias || !targetBlock) {
    return targetAlias ?? null
  }

  if (targetBlock.type === 'loop') {
    if (edge.targetHandle === 'loop-end-target') {
      return createContainerNodeId(targetAlias, 'loop', 'end')
    }
    return createContainerNodeId(targetAlias, 'loop', 'start')
  }

  if (targetBlock.type === 'parallel') {
    if (edge.targetHandle === 'parallel-end-target') {
      return createContainerNodeId(targetAlias, 'parallel', 'end')
    }
    return createContainerNodeId(targetAlias, 'parallel', 'start')
  }

  return targetAlias
}

function resolveVisibleEdgeLabel(edge: Edge, blocks: Record<string, BlockState>): string | null {
  const sourceBlock = blocks[edge.source]
  const sourceHandle = edge.sourceHandle || 'source'
  const targetHandle = edge.targetHandle || 'target'

  if (sourceBlock?.type === 'condition') {
    const semanticCondition = extractConditionDisplayKey(sourceBlock.id, edge.sourceHandle)
    if (semanticCondition) {
      return null
    }
  }

  const hiddenHandles = new Set([
    'source',
    'target',
    'input',
    'output',
    'loop-start-source',
    'loop-end-source',
    'parallel-start-source',
    'parallel-end-source',
    'loop-end-target',
    'parallel-end-target',
  ])

  if (hiddenHandles.has(sourceHandle) && hiddenHandles.has(targetHandle)) {
    return null
  }

  return `${sourceHandle} -> ${targetHandle}`
}

function emitEdgeGraphLine(
  edge: Edge,
  blocks: Record<string, BlockState>,
  preferredBlockNodeIds: Map<string, string>,
  aliases: Map<string, string>
): string | null {
  const sourceNodeId = resolveVisibleSourceNodeId(edge, blocks, preferredBlockNodeIds, aliases)
  const targetNodeId = resolveVisibleTargetNodeId(edge, blocks, preferredBlockNodeIds, aliases)

  if (!sourceNodeId || !targetNodeId) {
    return null
  }

  const label = resolveVisibleEdgeLabel(edge, blocks)
  if (!label) {
    return `  ${sourceNodeId} --> ${targetNodeId}`
  }

  return `  ${sourceNodeId} -- "${escapeMermaidLabel(label)}" --> ${targetNodeId}`
}

function parseCommentPayload<T>(line: string, prefix: string): T | null {
  if (!line.startsWith(prefix)) {
    return null
  }

  try {
    return JSON.parse(line.slice(prefix.length)) as T
  } catch (error) {
    throw new Error(
      `Invalid ${prefix.trim()} payload: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function normalizeMetadataValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseOverlayFromLabel(label: string): MermaidLabelOverlay | null {
  const lines = unescapeMermaidLabel(label)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return null
  }

  const overlay: MermaidLabelOverlay = {
    id: '',
    name: lines[0],
    dataEntries: {},
    subBlockEntries: {},
  }

  const conditionEntries: ConditionEntry[] = []

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const rawKey = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()

    if (rawKey === 'id') {
      overlay.id = rawValue
      continue
    }
    if (rawKey === 'type') {
      overlay.type = rawValue
      continue
    }
    if (rawKey === 'enabled') {
      overlay.enabled = Boolean(parseLabelValue(rawValue))
      continue
    }
    if (rawKey === 'advancedMode') {
      overlay.advancedMode = Boolean(parseLabelValue(rawValue))
      continue
    }
    if (rawKey === 'triggerMode') {
      overlay.triggerMode = Boolean(parseLabelValue(rawValue))
      continue
    }
    if (rawKey === 'outputs') {
      const parsed = parseLabelValue(rawValue)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        overlay.outputs = parsed as Record<string, unknown>
      }
      continue
    }
    if (rawKey.startsWith('data.')) {
      overlay.dataEntries[rawKey.slice('data.'.length)] = parseLabelValue(rawValue)
      continue
    }
    if (rawKey.startsWith('subBlocks.')) {
      overlay.subBlockEntries[rawKey.slice('subBlocks.'.length)] = parseLabelValue(rawValue)
      continue
    }
    if (
      rawKey === 'if' ||
      rawKey === 'else' ||
      rawKey === 'else-if' ||
      rawKey.startsWith('else-if-')
    ) {
      conditionEntries.push({ key: rawKey, value: rawValue })
    }
  }

  if (overlay.id.length === 0) {
    return null
  }

  if (conditionEntries.length > 0) {
    overlay.subBlockEntries[CONDITION_INPUT_KEY] = buildConditionStoredValue(
      overlay.id,
      conditionEntries
    )
  }

  return overlay
}

function parseConditionBranchOverlayFromLabel(
  label: string,
  knownBlockIds: string[]
): ConditionBranchOverlay | null {
  const lines = unescapeMermaidLabel(label)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return null
  }

  let handleId = ''
  let value = ''

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const rawKey = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()

    if (rawKey === 'id') {
      handleId = rawValue
      continue
    }

    if (rawKey === 'value') {
      value = rawValue
    }
  }

  if (!handleId.startsWith('condition-')) {
    return null
  }

  const blockId = [...knownBlockIds]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => handleId.startsWith(`condition-${candidate}-`))

  if (!blockId) {
    return null
  }

  const key = handleId.slice(`condition-${blockId}-`.length)
  if (key.length === 0) {
    return null
  }

  return {
    blockId,
    key,
    value,
  }
}

function parseMermaidLabelOverlays(
  document: string,
  knownBlockIds: string[]
): ParsedMermaidLabelOverlays {
  const blocks = new Map<string, MermaidLabelOverlay>()
  const conditionBranches = new Map<string, ConditionEntry[]>()

  for (const rawLine of document.split(/\r?\n/)) {
    const trimmed = rawLine.trim()

    const subgraphMatch = trimmed.match(/^subgraph\s+\S+\["(.*)"\]$/)
    if (subgraphMatch?.[1]) {
      const overlay = parseOverlayFromLabel(subgraphMatch[1])
      if (overlay) {
        blocks.set(overlay.id, overlay)
      }
      continue
    }

    const rectNode = parseRectNodeLine(trimmed)
    if (rectNode) {
      const conditionOverlay = parseConditionBranchOverlayFromLabel(rectNode.label, knownBlockIds)
      if (conditionOverlay) {
        const entries = conditionBranches.get(conditionOverlay.blockId) ?? []
        entries.push({ key: conditionOverlay.key, value: conditionOverlay.value })
        conditionBranches.set(conditionOverlay.blockId, entries)
        continue
      }

      const overlay = parseOverlayFromLabel(rectNode.label)
      if (overlay) {
        blocks.set(overlay.id, overlay)
      }
      continue
    }

    const diamondMatch = trimmed.match(/^[A-Za-z0-9_]+\{"(.*)"\}$/)
    if (diamondMatch?.[1]) {
      const overlay = parseOverlayFromLabel(diamondMatch[1])
      if (overlay) {
        blocks.set(overlay.id, overlay)
      }
    }
  }

  return { blocks, conditionBranches }
}

function parseVisibleEdgeLabel(
  rawLabel: string
): { sourceHandle: string; targetHandle: string } | null {
  const label = unescapeMermaidLabel(rawLabel).trim()
  const separator = ' -> '
  const separatorIndex = label.indexOf(separator)
  if (separatorIndex === -1) {
    return null
  }

  const sourceHandle = label.slice(0, separatorIndex).trim()
  const targetHandle = label.slice(separatorIndex + separator.length).trim()

  if (!sourceHandle || !targetHandle) {
    return null
  }

  return { sourceHandle, targetHandle }
}

function getDefaultVisibleSourceHandle(nodeRef: VisibleNodeRef): string {
  switch (nodeRef.kind) {
    case 'condition-branch':
      return nodeRef.sourceHandle
    case 'container-start':
      return `${nodeRef.blockType}-start-source`
    case 'container-end':
      return `${nodeRef.blockType}-end-source`
    case 'block':
    default:
      return 'source'
  }
}

function getDefaultVisibleTargetHandle(nodeRef: VisibleNodeRef): string {
  switch (nodeRef.kind) {
    case 'container-end':
      return `${nodeRef.blockType}-end-target`
    case 'block':
    case 'condition-branch':
    case 'container-start':
    default:
      return 'target'
  }
}

function toComparableEdgeKey(
  edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>
): string {
  const sourceHandle =
    !edge.sourceHandle || edge.sourceHandle === 'source' || edge.sourceHandle === 'output'
      ? 'source'
      : edge.sourceHandle
  const targetHandle =
    !edge.targetHandle || edge.targetHandle === 'target' || edge.targetHandle === 'input'
      ? 'target'
      : edge.targetHandle

  return `${edge.source}:${sourceHandle}->${edge.target}:${targetHandle}`
}

function parseVisibleWorkflowEdges(
  document: string,
  knownBlockIds: string[]
): ParsedVisibleWorkflowEdges {
  const nodeRefs = new Map<string, VisibleNodeRef>()
  const aliasToBlockId = new Map<string, string>()
  const preferredBlockNodeIds = new Map<string, string>()
  const knownBlockIdSet = new Set(knownBlockIds)
  const visibleBlockIds = new Set<string>()
  const inferredParentIds = new Map<string, string>()
  const subgraphStack: Array<{ blockId: string | null; isContainer: boolean }> = []

  const getActiveContainerId = (): string | null => {
    for (let index = subgraphStack.length - 1; index >= 0; index -= 1) {
      const entry = subgraphStack[index]
      if (entry?.isContainer && entry.blockId) {
        return entry.blockId
      }
    }

    return null
  }

  for (const rawLine of document.split(/\r?\n/)) {
    const trimmed = rawLine.trim()

    if (trimmed === 'end') {
      subgraphStack.pop()
      continue
    }

    const subgraphMatch = trimmed.match(/^subgraph\s+(sg_[A-Za-z0-9_]+)\["(.*)"\]$/)
    if (subgraphMatch?.[1] && subgraphMatch[2]) {
      const currentContainerId = getActiveContainerId()
      const overlay = parseOverlayFromLabel(subgraphMatch[2])
      if (overlay) {
        const nodeId = subgraphMatch[1].slice(3)
        aliasToBlockId.set(nodeId, overlay.id)
        nodeRefs.set(nodeId, { kind: 'block', blockId: overlay.id })
        visibleBlockIds.add(overlay.id)
        if (currentContainerId && currentContainerId !== overlay.id) {
          inferredParentIds.set(overlay.id, currentContainerId)
        }
        if (!preferredBlockNodeIds.has(overlay.id)) {
          preferredBlockNodeIds.set(overlay.id, nodeId)
        }
        subgraphStack.push({
          blockId: overlay.id,
          isContainer: overlay.type === 'loop' || overlay.type === 'parallel',
        })
      } else {
        subgraphStack.push({ blockId: null, isContainer: false })
      }
      continue
    }

    if (trimmed.startsWith('subgraph ')) {
      subgraphStack.push({ blockId: null, isContainer: false })
      continue
    }

    const rectNode = parseRectNodeLine(trimmed)
    if (rectNode) {
      const nodeId = rectNode.nodeId
      const currentContainerId = getActiveContainerId()
      const conditionOverlay = parseConditionBranchOverlayFromLabel(rectNode.label, knownBlockIds)
      if (conditionOverlay) {
        nodeRefs.set(nodeId, {
          kind: 'condition-branch',
          blockId: conditionOverlay.blockId,
          sourceHandle: buildConditionHandleId(conditionOverlay.blockId, conditionOverlay.key),
        })
        continue
      }

      const directBlockId = resolveBlockIdFromVisibleNodeId(nodeId, knownBlockIdSet, aliasToBlockId)
      if (directBlockId) {
        nodeRefs.set(nodeId, { kind: 'block', blockId: directBlockId })
        visibleBlockIds.add(directBlockId)
        if (currentContainerId && currentContainerId !== directBlockId) {
          inferredParentIds.set(directBlockId, currentContainerId)
        }
        if (!preferredBlockNodeIds.has(directBlockId)) {
          preferredBlockNodeIds.set(directBlockId, nodeId)
        }
        continue
      }

      const overlay = parseOverlayFromLabel(rectNode.label)
      if (overlay) {
        aliasToBlockId.set(nodeId, overlay.id)
        nodeRefs.set(nodeId, { kind: 'block', blockId: overlay.id })
        visibleBlockIds.add(overlay.id)
        if (currentContainerId && currentContainerId !== overlay.id) {
          inferredParentIds.set(overlay.id, currentContainerId)
        }
        if (!preferredBlockNodeIds.has(overlay.id)) {
          preferredBlockNodeIds.set(overlay.id, nodeId)
        }
        continue
      }

      const containerMatch = nodeId.match(/^([A-Za-z0-9_]+)__(loop|parallel)_(start|end)$/)
      if (containerMatch?.[1] && containerMatch[2] && containerMatch[3]) {
        const blockId = resolveBlockIdFromVisibleNodeId(
          containerMatch[1],
          knownBlockIdSet,
          aliasToBlockId
        )
        const blockType = containerMatch[2] as 'loop' | 'parallel'
        if (blockId) {
          nodeRefs.set(nodeId, {
            kind: containerMatch[3] === 'start' ? 'container-start' : 'container-end',
            blockId,
            blockType,
          })
        }
      }
      continue
    }

    const diamondMatch = trimmed.match(/^([A-Za-z0-9_]+)\{"(.*)"\}$/)
    if (diamondMatch?.[1] && diamondMatch[2]) {
      const currentContainerId = getActiveContainerId()
      const overlay = parseOverlayFromLabel(diamondMatch[2])
      if (overlay) {
        aliasToBlockId.set(diamondMatch[1], overlay.id)
        nodeRefs.set(diamondMatch[1], { kind: 'block', blockId: overlay.id })
        visibleBlockIds.add(overlay.id)
        if (currentContainerId && currentContainerId !== overlay.id) {
          inferredParentIds.set(overlay.id, currentContainerId)
        }
        if (!preferredBlockNodeIds.has(overlay.id)) {
          preferredBlockNodeIds.set(overlay.id, diamondMatch[1])
        }
      }
    }
  }

  const visibleEdges: Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>> = []

  for (const rawLine of document.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    const edgeMatch = trimmed.match(
      /^([A-Za-z0-9_]+)\s*(?:--\s*"((?:\\"|[^"])*)"\s*)?-->\s*([A-Za-z0-9_]+)$/
    )
    if (!edgeMatch?.[1] || !edgeMatch[3]) {
      continue
    }

    const sourceRef = nodeRefs.get(edgeMatch[1])
    const targetRef = nodeRefs.get(edgeMatch[3])
    if (!sourceRef || !targetRef) {
      continue
    }

    if (
      sourceRef.kind === 'block' &&
      targetRef.kind === 'condition-branch' &&
      sourceRef.blockId === targetRef.blockId
    ) {
      continue
    }

    const parsedLabel = edgeMatch[2] ? parseVisibleEdgeLabel(edgeMatch[2]) : null
    const sourceHandle = parsedLabel?.sourceHandle ?? getDefaultVisibleSourceHandle(sourceRef)
    const targetHandle = parsedLabel?.targetHandle ?? getDefaultVisibleTargetHandle(targetRef)

    visibleEdges.push({
      source: sourceRef.blockId,
      target: targetRef.blockId,
      ...(sourceHandle === 'source' ? {} : { sourceHandle }),
      ...(targetHandle === 'target' ? {} : { targetHandle }),
    })
  }

  return {
    edges: visibleEdges,
    preferredBlockNodeIds,
    visibleBlockIds,
    inferredParentIds,
  }
}

function isContainerBlockType(blockType: string | undefined): blockType is 'loop' | 'parallel' {
  return blockType === 'loop' || blockType === 'parallel'
}

function getContainerAncestorChain(
  blockId: string,
  blocks: Record<string, BlockState>
): string[] {
  const chain: string[] = []
  const visited = new Set<string>()
  let currentParentId = blocks[blockId]?.data?.parentId

  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId)

    if (!isContainerBlockType(blocks[currentParentId]?.type)) {
      break
    }

    chain.unshift(currentParentId)
    currentParentId = blocks[currentParentId]?.data?.parentId
  }

  return chain
}

function isContainerStartSourceHandle(handle: string | null | undefined): boolean {
  return handle === 'loop-start-source' || handle === 'parallel-start-source'
}

function isContainerEndTargetHandle(handle: string | null | undefined): boolean {
  return handle === 'loop-end-target' || handle === 'parallel-end-target'
}

function normalizeContainerBoundaryHandles(
  edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>,
  blocks: Record<string, BlockState>
): Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'> {
  const sourceBlock = blocks[edge.source]
  const targetBlock = blocks[edge.target]
  const sourceAncestors = getContainerAncestorChain(edge.source, blocks)
  const targetAncestors = getContainerAncestorChain(edge.target, blocks)

  let sourceHandle = edge.sourceHandle
  let targetHandle = edge.targetHandle

  if (
    isContainerBlockType(sourceBlock?.type) &&
    !sourceHandle &&
    targetAncestors.includes(edge.source)
  ) {
    sourceHandle = `${sourceBlock.type}-start-source`
  } else if (
    isContainerBlockType(sourceBlock?.type) &&
    !sourceHandle &&
    !targetAncestors.includes(edge.source)
  ) {
    sourceHandle = `${sourceBlock.type}-end-source`
  }

  if (
    isContainerBlockType(targetBlock?.type) &&
    !targetHandle &&
    sourceAncestors.includes(edge.target)
  ) {
    targetHandle = `${targetBlock.type}-end-target`
  }

  return {
    source: edge.source,
    target: edge.target,
    ...(sourceHandle ? { sourceHandle } : {}),
    ...(targetHandle ? { targetHandle } : {}),
  }
}

function getEdgeSourceContext(
  edge: Pick<Edge, 'source' | 'sourceHandle'>,
  blocks: Record<string, BlockState>
): string[] {
  const context = getContainerAncestorChain(edge.source, blocks)

  if (isContainerStartSourceHandle(edge.sourceHandle) && isContainerBlockType(blocks[edge.source]?.type)) {
    context.push(edge.source)
  }

  return context
}

function getEdgeTargetContext(
  edge: Pick<Edge, 'target' | 'targetHandle'>,
  blocks: Record<string, BlockState>
): string[] {
  const context = getContainerAncestorChain(edge.target, blocks)

  if (isContainerEndTargetHandle(edge.targetHandle) && isContainerBlockType(blocks[edge.target]?.type)) {
    context.push(edge.target)
  }

  return context
}

function toNormalizedEdge(
  edge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>
): Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'> {
  return {
    source: edge.source,
    target: edge.target,
    ...(edge.sourceHandle && edge.sourceHandle !== 'source' ? { sourceHandle: edge.sourceHandle } : {}),
    ...(edge.targetHandle && edge.targetHandle !== 'target' ? { targetHandle: edge.targetHandle } : {}),
  }
}

function expandEdgeAcrossContainerBoundaries(
  rawEdge: Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>,
  blocks: Record<string, BlockState>
): Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>> {
  const edge = normalizeContainerBoundaryHandles(rawEdge, blocks)
  const sourceContext = getEdgeSourceContext(edge, blocks)
  const targetContext = getEdgeTargetContext(edge, blocks)
  let commonDepth = 0

  while (
    commonDepth < sourceContext.length &&
    commonDepth < targetContext.length &&
    sourceContext[commonDepth] === targetContext[commonDepth]
  ) {
    commonDepth += 1
  }

  const expanded: Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>> = []
  let currentSource = edge.source
  let currentSourceHandle = edge.sourceHandle

  for (let index = sourceContext.length - 1; index >= commonDepth; index -= 1) {
    const containerId = sourceContext[index]
    const containerType = blocks[containerId]?.type

    if (!isContainerBlockType(containerType)) {
      continue
    }

    expanded.push(
      toNormalizedEdge({
        source: currentSource,
        target: containerId,
        sourceHandle: currentSourceHandle,
        targetHandle: `${containerType}-end-target`,
      })
    )

    currentSource = containerId
    currentSourceHandle = `${containerType}-end-source`
  }

  for (let index = commonDepth; index < targetContext.length; index += 1) {
    const containerId = targetContext[index]
    const containerType = blocks[containerId]?.type

    if (!isContainerBlockType(containerType)) {
      continue
    }

    expanded.push(
      toNormalizedEdge({
        source: currentSource,
        target: containerId,
        sourceHandle: currentSourceHandle,
      })
    )

    currentSource = containerId
    currentSourceHandle = `${containerType}-start-source`
  }

  expanded.push(
    toNormalizedEdge({
      source: currentSource,
      target: edge.target,
      sourceHandle: currentSourceHandle,
      targetHandle: edge.targetHandle,
    })
  )

  return expanded
}

function normalizeLogicalWorkflowEdges(
  edges: Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>,
  blocks: Record<string, BlockState>
): Edge[] {
  const normalizedEdges = new Map<
    string,
    Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>
  >()

  for (const edge of edges) {
    for (const expandedEdge of expandEdgeAcrossContainerBoundaries(edge, blocks)) {
      normalizedEdges.set(toComparableEdgeKey(expandedEdge), expandedEdge)
    }
  }

  return [...normalizedEdges.values()].map((edge) => ({
    ...edge,
    id: buildStableEdgeId(edge),
  }))
}

function applyVisibleParenting(
  blocks: Record<string, BlockState>,
  visibleBlockIds: Set<string>,
  inferredParentIds: Map<string, string>
): Record<string, BlockState> {
  const nextBlocks: Record<string, BlockState> = { ...blocks }

  for (const blockId of visibleBlockIds) {
    const block = nextBlocks[blockId]

    if (!block) {
      continue
    }

    const nextParentId = inferredParentIds.get(blockId)
    const nextData = { ...(block.data ?? {}) }

    if (nextParentId) {
      nextData.parentId = nextParentId
      nextData.extent = 'parent'
    } else {
      delete nextData.parentId
      delete nextData.extent
    }

    nextBlocks[blockId] = {
      ...block,
      ...(Object.keys(nextData).length > 0 ? { data: nextData as any } : {}),
    }
  }

  return nextBlocks
}

function syncContainerNodeMembership(
  blocks: Record<string, BlockState>,
  loops: Record<string, Loop>,
  parallels: Record<string, Parallel>
): { loops: Record<string, Loop>; parallels: Record<string, Parallel> } {
  const childrenByParent = getChildrenByParent(blocks)

  const nextLoops = Object.fromEntries(
    Object.entries(loops).map(([loopId, loop]) => [
      loopId,
      {
        ...loop,
        nodes: [...(childrenByParent.get(loopId) ?? [])],
      },
    ])
  )

  const nextParallels = Object.fromEntries(
    Object.entries(parallels).map(([parallelId, parallel]) => [
      parallelId,
      {
        ...parallel,
        nodes: [...(childrenByParent.get(parallelId) ?? [])],
      },
    ])
  )

  return {
    loops: nextLoops,
    parallels: nextParallels,
  }
}

function assertVisibleEdgesMatchCanonical(
  document: string,
  blocks: Record<string, BlockState>,
  edges: Edge[]
): void {
  const { edges: visibleEdges, preferredBlockNodeIds } = parseVisibleWorkflowEdges(
    document,
    Object.keys(blocks)
  )
  const normalizedVisibleEdges = normalizeLogicalWorkflowEdges(visibleEdges, blocks)
  const normalizedCanonicalEdges = normalizeLogicalWorkflowEdges(edges, blocks)
  const visibleEdgeKeys = new Set(normalizedVisibleEdges.map(toComparableEdgeKey))
  const canonicalEdgeKeys = new Set(normalizedCanonicalEdges.map(toComparableEdgeKey))

  if (visibleEdgeKeys.size === 0 && canonicalEdgeKeys.size === 0) {
    return
  }

  const missingCanonical = [...visibleEdgeKeys].filter((key) => !canonicalEdgeKeys.has(key))
  const missingVisible = [...canonicalEdgeKeys].filter((key) => !visibleEdgeKeys.has(key))
  const canonicalEdgeByKey = new Map(
    normalizedCanonicalEdges.map((edge) => [toComparableEdgeKey(edge), edge] as const)
  )
  const aliases = buildAliasMap(Object.keys(blocks))

  if (missingCanonical.length === 0 && missingVisible.length === 0) {
    return
  }

  if (canonicalEdgeKeys.size === 0 && visibleEdgeKeys.size > 0) {
    throw new Error(
      'Workflow document contains Mermaid connection lines but no TG_EDGE entries. Every visible workflow connection must have a matching TG_EDGE payload.'
    )
  }

  const detailParts: string[] = []
  if (missingCanonical.length > 0) {
    detailParts.push(`missing TG_EDGE entries for ${missingCanonical.slice(0, 3).join(', ')}`)
  }
  if (missingVisible.length > 0) {
    detailParts.push(`missing visible connection lines for ${missingVisible.slice(0, 3).join(', ')}`)
    const expectedVisibleLines = missingVisible
      .map((key) => canonicalEdgeByKey.get(key))
      .filter((edge): edge is Edge => !!edge)
      .map((edge) => emitEdgeGraphLine(edge, blocks, preferredBlockNodeIds, aliases))
      .filter((line): line is string => typeof line === 'string' && line.trim().length > 0)

    if (expectedVisibleLines.length > 0) {
      detailParts.push(
        `expected visible lines like ${expectedVisibleLines
          .slice(0, 3)
          .map((line) => `\`${line.trim()}\``)
          .join(', ')}`
      )
    }
  }

  throw new Error(
    `Workflow document edge metadata is inconsistent. Visible Mermaid connections and TG_EDGE payloads must resolve to the same logical workflow edges.${detailParts.length > 0 ? ` ${detailParts.join('; ')}.` : ''}`
  )
}

function mergeOverlayIntoBlock(
  blockId: string,
  existingBlock: BlockState | undefined,
  overlay: MermaidLabelOverlay
): BlockState {
  const nextSubBlocks = { ...(existingBlock?.subBlocks ?? {}) }
  for (const [subBlockId, value] of Object.entries(overlay.subBlockEntries)) {
    const existingSubBlock = nextSubBlocks[subBlockId]
    nextSubBlocks[subBlockId] = {
      id: subBlockId,
      type:
        existingSubBlock?.type ?? (subBlockId === CONDITION_INPUT_KEY ? 'condition-input' : 'short-input'),
      value: value as any,
    }
  }

  const nextData = {
    ...(existingBlock?.data ?? {}),
    ...overlay.dataEntries,
  }

  return {
    id: blockId,
    type: overlay.type ?? existingBlock?.type ?? 'unknown',
    name: overlay.name || existingBlock?.name || blockId,
    position: existingBlock?.position ?? { x: 0, y: 0 },
    subBlocks: nextSubBlocks,
    outputs: (overlay.outputs as any) ?? existingBlock?.outputs ?? {},
    enabled: overlay.enabled ?? existingBlock?.enabled ?? true,
    ...(existingBlock?.locked !== undefined ? { locked: existingBlock.locked } : {}),
    ...(existingBlock?.horizontalHandles !== undefined
      ? { horizontalHandles: existingBlock.horizontalHandles }
      : {}),
    ...(existingBlock?.isWide !== undefined ? { isWide: existingBlock.isWide } : {}),
    ...(existingBlock?.height !== undefined ? { height: existingBlock.height } : {}),
    ...(overlay.advancedMode !== undefined
      ? { advancedMode: overlay.advancedMode }
      : existingBlock?.advancedMode !== undefined
        ? { advancedMode: existingBlock.advancedMode }
        : {}),
    ...(overlay.triggerMode !== undefined
      ? { triggerMode: overlay.triggerMode }
      : existingBlock?.triggerMode !== undefined
        ? { triggerMode: existingBlock.triggerMode }
        : {}),
    ...(Object.keys(nextData).length > 0 ? { data: nextData as any } : {}),
    ...(existingBlock?.layout ? { layout: existingBlock.layout } : {}),
  }
}

function mergeConditionEntriesIntoBlock(
  blockId: string,
  existingBlock: BlockState,
  entries: ConditionEntry[]
): BlockState {
  const existingEntries = parseConditionEntries(existingBlock.subBlocks?.[CONDITION_INPUT_KEY]?.value)
  const existingSignature = toDocumentJson(existingEntries)
  const nextSignature = toDocumentJson(parseConditionEntries(entries))

  if (existingSignature === nextSignature) {
    return existingBlock
  }

  const nextSubBlocks = { ...(existingBlock.subBlocks ?? {}) }
  const existingConditionSubBlock = nextSubBlocks[CONDITION_INPUT_KEY]

  nextSubBlocks[CONDITION_INPUT_KEY] = {
    id: CONDITION_INPUT_KEY,
    type: existingConditionSubBlock?.type ?? 'condition-input',
    value: buildConditionStoredValue(blockId, entries),
  }

  return {
    ...existingBlock,
    subBlocks: nextSubBlocks,
  }
}

function assertBlockState(value: unknown): asserts value is BlockState {
  if (!value || typeof value !== 'object') {
    throw new Error(
      'Invalid TG_BLOCK payload: expected object with string id and string type. Workflow documents use `type`, not `blockType`.'
    )
  }

  const candidate = value as Partial<BlockState>
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') {
    throw new Error(
      'Invalid TG_BLOCK payload: expected object with string id and string type. Workflow documents use `type`, not `blockType`.'
    )
  }

  if (typeof candidate.name !== 'string') {
    throw new Error(
      'Invalid TG_BLOCK payload: expected string name. Workflow documents use canonical TG_BLOCK objects, not block metadata aliases.'
    )
  }

  if (
    !candidate.position ||
    typeof candidate.position !== 'object' ||
    typeof candidate.position.x !== 'number' ||
    typeof candidate.position.y !== 'number'
  ) {
    throw new Error(
      'Invalid TG_BLOCK payload: expected position with numeric x and y values.'
    )
  }

  if (!candidate.subBlocks || typeof candidate.subBlocks !== 'object' || Array.isArray(candidate.subBlocks)) {
    throw new Error('Invalid TG_BLOCK payload: expected subBlocks object.')
  }

  if (!candidate.outputs || typeof candidate.outputs !== 'object' || Array.isArray(candidate.outputs)) {
    throw new Error('Invalid TG_BLOCK payload: expected outputs object.')
  }

  if (typeof candidate.enabled !== 'boolean') {
    throw new Error('Invalid TG_BLOCK payload: expected boolean enabled flag.')
  }
}

function assertEdge(value: unknown): asserts value is Edge {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid TG_EDGE payload')
  }

  const candidate = value as Partial<Edge>
  if (typeof candidate.source !== 'string' || typeof candidate.target !== 'string') {
    throw new Error('Invalid TG_EDGE payload')
  }
}

function assertLoop(value: unknown): asserts value is Loop {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid TG_LOOP payload')
  }

  const candidate = value as Partial<Loop>
  if (typeof candidate.id !== 'string' || !Array.isArray(candidate.nodes)) {
    throw new Error('Invalid TG_LOOP payload')
  }
}

function assertParallel(value: unknown): asserts value is Parallel {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid TG_PARALLEL payload')
  }

  const candidate = value as Partial<Parallel>
  if (typeof candidate.id !== 'string' || !Array.isArray(candidate.nodes)) {
    throw new Error('Invalid TG_PARALLEL payload')
  }
}

export function serializeWorkflowToTgMermaid(
  workflowState: WorkflowSnapshot,
  options: { direction?: WorkflowDirection } = {}
): string {
  const direction =
    options.direction ??
    workflowState.direction ??
    inferMermaidDirectionFromWorkflowState(workflowState)
  const blocks = workflowState.blocks ?? {}
  const blockIds = Object.keys(blocks).sort((left, right) => left.localeCompare(right))
  const aliases = buildAliasMap(blockIds)
  const childrenByParent = getChildrenByParent(blocks)
  const rootBlockIds = blockIds.filter((blockId) => {
    const parentId = blocks[blockId]?.data?.parentId
    return !parentId || !blocks[parentId]
  })

  const lines = [
    `flowchart ${direction}`,
    toCommentLine(TG_WORKFLOW_PREFIX, {
      version: TG_MERMAID_DOCUMENT_FORMAT,
      direction,
      ...(workflowState.lastSaved ? { lastSaved: workflowState.lastSaved } : {}),
      ...(workflowState.isDeployed !== undefined ? { isDeployed: workflowState.isDeployed } : {}),
      ...(workflowState.deployedAt ? { deployedAt: workflowState.deployedAt } : {}),
    } satisfies WorkflowDocumentMetadata),
  ]

  for (const blockId of rootBlockIds) {
    emitBlockGraphLines({ blockId, blocks, aliases, childrenByParent, lines })
  }

  for (const edge of workflowState.edges ?? []) {
    const line = emitEdgeGraphLine(edge, blocks, aliases, aliases)
    if (line) {
      lines.push(line)
    }
  }

  for (const blockId of blockIds) {
    lines.push(toCommentLine(TG_BLOCK_PREFIX, blocks[blockId]))
  }

  for (const edge of workflowState.edges ?? []) {
    lines.push(toCommentLine(TG_EDGE_PREFIX, edge))
  }

  const loopIds = Object.keys(workflowState.loops ?? {}).sort((left, right) => left.localeCompare(right))
  for (const loopId of loopIds) {
    lines.push(toCommentLine(TG_LOOP_PREFIX, workflowState.loops[loopId]))
  }

  const parallelIds = Object.keys(workflowState.parallels ?? {}).sort((left, right) =>
    left.localeCompare(right)
  )
  for (const parallelId of parallelIds) {
    lines.push(toCommentLine(TG_PARALLEL_PREFIX, workflowState.parallels[parallelId]))
  }

  return lines.join('\n')
}

export function parseTgMermaidToWorkflow(
  document: string
): WorkflowSnapshot & { direction: WorkflowDirection } {
  if (typeof document !== 'string' || document.trim().length === 0) {
    throw new Error('Workflow document is required')
  }

  const lines = document.split(/\r?\n/)
  const metadata = lines
    .map((line) => parseCommentPayload<WorkflowDocumentMetadata>(line.trim(), TG_WORKFLOW_PREFIX))
    .find((value): value is WorkflowDocumentMetadata => !!value)

  if (!metadata) {
    throw new Error('Missing TG_WORKFLOW metadata')
  }

  if (metadata.version !== TG_MERMAID_DOCUMENT_FORMAT) {
    throw new Error(`Unsupported workflow document version: ${metadata.version}`)
  }

  if (metadata.direction !== 'TD' && metadata.direction !== 'LR') {
    throw new Error('Invalid TG_WORKFLOW metadata: direction must be TD or LR')
  }

  const blocks: Record<string, BlockState> = {}
  const edges: Edge[] = []
  const loops: Record<string, Loop> = {}
  const parallels: Record<string, Parallel> = {}

  for (const rawLine of lines) {
    const line = rawLine.trim()

    const block = parseCommentPayload<BlockState>(line, TG_BLOCK_PREFIX)
    if (block) {
      assertBlockState(block)
      blocks[block.id] = block
      continue
    }

    const edge = parseCommentPayload<Edge>(line, TG_EDGE_PREFIX)
    if (edge) {
      assertEdge(edge)
      edges.push({
        ...edge,
        id: edge.id || buildStableEdgeId(edge),
      })
      continue
    }

    const loop = parseCommentPayload<Loop>(line, TG_LOOP_PREFIX)
    if (loop) {
      assertLoop(loop)
      loops[loop.id] = loop
      continue
    }

    const parallel = parseCommentPayload<Parallel>(line, TG_PARALLEL_PREFIX)
    if (parallel) {
      assertParallel(parallel)
      parallels[parallel.id] = parallel
    }
  }

  const overlays = parseMermaidLabelOverlays(document, Object.keys(blocks))

  for (const [blockId, overlay] of overlays.blocks) {
    blocks[blockId] = mergeOverlayIntoBlock(blockId, blocks[blockId], overlay)
  }

  for (const [blockId, entries] of overlays.conditionBranches) {
    const existingBlock = blocks[blockId]
    if (!existingBlock) {
      continue
    }

    blocks[blockId] = mergeConditionEntriesIntoBlock(blockId, existingBlock, entries)
  }

  const visibleGraph = parseVisibleWorkflowEdges(document, Object.keys(blocks))
  const blocksWithVisibleParenting = applyVisibleParenting(
    blocks,
    visibleGraph.visibleBlockIds,
    visibleGraph.inferredParentIds
  )
  const normalizedVisibleEdges = normalizeLogicalWorkflowEdges(visibleGraph.edges, blocksWithVisibleParenting)
  const normalizedCanonicalEdges = normalizeLogicalWorkflowEdges(edges, blocksWithVisibleParenting)
  const syncedContainers = syncContainerNodeMembership(blocksWithVisibleParenting, loops, parallels)

  if (Object.keys(blocksWithVisibleParenting).length === 0) {
    throw new Error('Workflow document did not contain any TG_BLOCK entries')
  }

  assertVisibleEdgesMatchCanonical(document, blocksWithVisibleParenting, edges)

  return {
    direction: metadata.direction,
    blocks: blocksWithVisibleParenting,
    edges: visibleGraph.edges.length > 0 ? normalizedVisibleEdges : normalizedCanonicalEdges,
    loops: syncedContainers.loops,
    parallels: syncedContainers.parallels,
    ...(normalizeMetadataValue(metadata.lastSaved) ? { lastSaved: metadata.lastSaved } : {}),
    ...(metadata.isDeployed !== undefined ? { isDeployed: metadata.isDeployed } : {}),
    ...(normalizeMetadataValue(metadata.deployedAt) ? { deployedAt: metadata.deployedAt } : {}),
  }
}

export function buildWorkflowDocumentPreviewDiff(
  currentWorkflowState: WorkflowSnapshot | undefined,
  nextWorkflowState: WorkflowSnapshot
): {
  blockDiff: { added: string[]; removed: string[]; updated: string[] }
  edgeDiff: {
    added: Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>
    removed: Array<Pick<Edge, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>>
  }
  warnings: string[]
} {
  const currentBlocks = currentWorkflowState?.blocks ?? {}
  const nextBlocks = nextWorkflowState.blocks ?? {}

  const currentBlockIds = new Set(Object.keys(currentBlocks))
  const nextBlockIds = new Set(Object.keys(nextBlocks))

  const added = [...nextBlockIds].filter((blockId) => !currentBlockIds.has(blockId)).sort()
  const removed = [...currentBlockIds].filter((blockId) => !nextBlockIds.has(blockId)).sort()
  const updated = [...nextBlockIds]
    .filter((blockId) => currentBlockIds.has(blockId))
    .filter(
      (blockId) =>
        toDocumentJson(currentBlocks[blockId]) !== toDocumentJson(nextBlocks[blockId])
    )
    .sort()

  const toComparableEdge = (edge: Edge) => ({
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || 'source',
    targetHandle: edge.targetHandle || 'target',
  })

  const currentEdges = (currentWorkflowState?.edges ?? []).map(toComparableEdge)
  const nextEdges = (nextWorkflowState.edges ?? []).map(toComparableEdge)
  const currentEdgeKeys = new Set(
    currentEdges.map(
      (edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
    )
  )
  const nextEdgeKeys = new Set(
    nextEdges.map(
      (edge) => `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
    )
  )

  const edgeDiff = {
    added: nextEdges.filter(
      (edge) =>
        !currentEdgeKeys.has(
          `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
        )
    ),
    removed: currentEdges.filter(
      (edge) =>
        !nextEdgeKeys.has(
          `${edge.source}:${edge.sourceHandle}->${edge.target}:${edge.targetHandle}`
        )
    ),
  }

  const warnings: string[] = []
  if (added.length === 0 && removed.length === 0 && updated.length === 0) {
    warnings.push('No block changes detected.')
  }
  if (edgeDiff.added.length === 0 && edgeDiff.removed.length === 0) {
    warnings.push('No edge changes detected.')
  }

  return {
    blockDiff: { added, removed, updated },
    edgeDiff,
    warnings,
  }
}
