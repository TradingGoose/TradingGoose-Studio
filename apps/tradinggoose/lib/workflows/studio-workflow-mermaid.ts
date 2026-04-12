import type { Edge } from 'reactflow'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

export const TG_MERMAID_DOCUMENT_FORMAT = 'tg-mermaid-v1' as const

type MermaidDirection = 'TD' | 'LR'

type WorkflowDocumentMetadata = {
  version: typeof TG_MERMAID_DOCUMENT_FORMAT
  direction: MermaidDirection
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

const COMMENT_PREFIX = '%% '
const TG_WORKFLOW_PREFIX = `${COMMENT_PREFIX}TG_WORKFLOW `
const TG_BLOCK_PREFIX = `${COMMENT_PREFIX}TG_BLOCK `
const TG_EDGE_PREFIX = `${COMMENT_PREFIX}TG_EDGE `
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
  aliases: Map<string, string>
): string | null {
  const sourceAlias = aliases.get(edge.source)
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
  aliases: Map<string, string>
): string | null {
  const targetAlias = aliases.get(edge.target)
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
  aliases: Map<string, string>
): string | null {
  const sourceNodeId = resolveVisibleSourceNodeId(edge, blocks, aliases)
  const targetNodeId = resolveVisibleTargetNodeId(edge, blocks, aliases)

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

    const rectMatch = trimmed.match(/^[A-Za-z0-9_]+\["(.*)"\]$/)
    if (rectMatch?.[1]) {
      const conditionOverlay = parseConditionBranchOverlayFromLabel(rectMatch[1], knownBlockIds)
      if (conditionOverlay) {
        const entries = conditionBranches.get(conditionOverlay.blockId) ?? []
        entries.push({ key: conditionOverlay.key, value: conditionOverlay.value })
        conditionBranches.set(conditionOverlay.blockId, entries)
        continue
      }

      const overlay = parseOverlayFromLabel(rectMatch[1])
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
    throw new Error('Invalid TG_BLOCK payload')
  }

  const candidate = value as Partial<BlockState>
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') {
    throw new Error('Invalid TG_BLOCK payload')
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
  options: { direction?: MermaidDirection } = {}
): string {
  const direction = options.direction ?? 'TD'
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
    const line = emitEdgeGraphLine(edge, blocks, aliases)
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

export function parseTgMermaidToWorkflow(document: string): WorkflowSnapshot {
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
      edges.push(edge)
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

  if (Object.keys(blocks).length === 0) {
    throw new Error('Workflow document did not contain any TG_BLOCK entries')
  }

  return {
    blocks,
    edges,
    loops,
    parallels,
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
