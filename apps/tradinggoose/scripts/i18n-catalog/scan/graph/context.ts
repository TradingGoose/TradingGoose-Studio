import { createEntryDiscoveryContext } from '../../entries'
import type { CatalogProjectContext } from '../core/types'

export function createCatalogProjectContext(projectRoot: string): CatalogProjectContext {
  return {
    entryDiscoveryContext: createEntryDiscoveryContext(projectRoot),
    projectFiles: new Map(),
    projectRoot,
  }
}
