import { create } from 'zustand'
import type { IndicatorsImportFile, IndicatorTransferRecord } from '@/lib/indicators/import-export'

const API_ENDPOINT = '/api/indicators/custom'

interface CreateIndicatorParams {
  workspaceId: string
  indicator: IndicatorTransferRecord
}

export async function createIndicator({ workspaceId, indicator }: CreateIndicatorParams) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      indicators: [indicator],
      workspaceId,
    }),
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to create indicator')
  if (!Array.isArray(data.data)) {
    throw new Error('Invalid API response: missing indicators data')
  }
  return data.data
}

interface ImportIndicatorsParams {
  workspaceId: string
  file: IndicatorsImportFile
}

export async function importIndicators({ workspaceId, file }: ImportIndicatorsParams) {
  const response = await fetch(`${API_ENDPOINT}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      file,
    }),
  })

  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to import indicators')
  return data
}

interface DeleteIndicatorParams {
  workspaceId: string
  indicatorId: string
}

export async function deleteIndicator({ workspaceId, indicatorId }: DeleteIndicatorParams) {
  const response = await fetch(`${API_ENDPOINT}?id=${indicatorId}&workspaceId=${workspaceId}`, {
    method: 'DELETE',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete indicator')
  }
}

export type IndicatorWrite =
  | { kind: 'create' | 'import'; workspaceId: string; ownerId: string }
  | {
      kind: 'copy' | 'rename' | 'delete'
      workspaceId: string
      ownerId: string
      indicatorId: string
    }

interface IndicatorWriteState {
  activeWrite: IndicatorWrite | null
  failedWrite: IndicatorWrite | null
  runWrite: (write: IndicatorWrite, effect: () => Promise<void>) => Promise<boolean>
}

export const useIndicatorWriteStore = create<IndicatorWriteState>((set, get) => ({
  activeWrite: null,
  failedWrite: null,
  runWrite: async (write, effect) => {
    if (get().activeWrite) return false
    set({ activeWrite: write, failedWrite: null })
    try {
      await effect()
      set({ activeWrite: null })
      return true
    } catch {
      set({ activeWrite: null, failedWrite: write })
      return false
    }
  },
}))
