/**
 * Serializers for workflow Yjs doc <-> canonical state conversion.
 *
 * Round-trips exact field names used by BlockState: subBlocks, outputs, data,
 * layout, enabled, horizontalHandles, isWide, advancedMode, triggerMode, height.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerializedBlockState {
  id: string
  type: string
  name: string
  position: { x: number; y: number }
  subBlocks: Record<string, any>
  outputs: Record<string, any>
  data: Record<string, any>
  layout?: { measuredWidth?: number; measuredHeight?: number }
  enabled?: boolean
  horizontalHandles?: boolean
  isWide?: boolean
  advancedMode?: boolean
  triggerMode?: boolean
  height?: number
}

// ---------------------------------------------------------------------------
// Block serialisation
// ---------------------------------------------------------------------------

/**
 * Converts an in-memory BlockState (or compatible object) into a plain
 * serialisable record suitable for storage in a Yjs map.
 */
export function serializeBlock(block: any): SerializedBlockState {
  return {
    id: block.id,
    type: block.type,
    name: block.name,
    position: block.position ?? { x: 0, y: 0 },
    subBlocks: block.subBlocks ?? {},
    outputs: block.outputs ?? {},
    data: block.data ?? {},
    layout: block.layout,
    enabled: block.enabled,
    horizontalHandles: block.horizontalHandles,
    isWide: block.isWide,
    advancedMode: block.advancedMode,
    triggerMode: block.triggerMode,
    height: block.height,
  }
}

/**
 * Converts a serialised block record back into a plain object.
 * Currently a shallow copy; callers should treat the result as a new object.
 */
export function deserializeBlock(serialized: SerializedBlockState): any {
  return { ...serialized }
}

/**
 * Batch-serialises a record of blocks keyed by id.
 */
export function serializeBlocks(blocks: Record<string, any>): Record<string, SerializedBlockState> {
  const result: Record<string, SerializedBlockState> = {}
  for (const [id, block] of Object.entries(blocks)) {
    result[id] = serializeBlock(block)
  }
  return result
}

