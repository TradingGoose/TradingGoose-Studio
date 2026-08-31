import {
  getListingIdentityKey,
  ListingIdentitySchema,
  type ListingResolved,
} from '@/lib/listing/identity'
import { resolveListingIdentity } from '@/lib/listing/resolve'

type ListingHydrationCache = Map<string, ListingResolved | null>

const resolveListingValue = async (
  value: unknown,
  cache: ListingHydrationCache
): Promise<unknown> => {
  const parsed = ListingIdentitySchema.safeParse(value)
  if (!parsed.success) return value

  const listingIdentity = parsed.data
  const key = getListingIdentityKey(listingIdentity)
  if (!cache.has(key)) {
    const resolved = await resolveListingIdentity(listingIdentity).catch(() => null)
    cache.set(key, resolved ?? null)
  }
  const resolved = cache.get(key)
  if (!resolved) return value

  return resolved
}

export async function hydrateListingUI(blocks: Record<string, any>): Promise<Record<string, any>> {
  const cache: ListingHydrationCache = new Map()
  let mutatedBlocks = false
  const nextBlocks: Record<string, any> = { ...blocks }

  const blockEntries = Object.entries(blocks)
  for (const [blockId, block] of blockEntries) {
    if (!block || typeof block !== 'object') continue
    const subBlocks = block.subBlocks
    if (!subBlocks || typeof subBlocks !== 'object') continue

    let blockChanged = false
    const nextSubBlocks: Record<string, any> = { ...subBlocks }

    const subBlockEntries = Object.entries(subBlocks)
    for (const [subBlockId, subBlock] of subBlockEntries) {
      if (!subBlock || typeof subBlock !== 'object') continue
      if ((subBlock as { type?: unknown }).type !== 'market-selector') continue
      const value = (subBlock as { value?: unknown }).value
      const resolvedValue = await resolveListingValue(value, cache)
      if (resolvedValue !== value) {
        blockChanged = true
        nextSubBlocks[subBlockId] = {
          ...subBlock,
          value: resolvedValue,
        }
      }
    }

    if (blockChanged) {
      mutatedBlocks = true
      nextBlocks[blockId] = {
        ...block,
        subBlocks: nextSubBlocks,
      }
    }
  }

  return mutatedBlocks ? nextBlocks : blocks
}
