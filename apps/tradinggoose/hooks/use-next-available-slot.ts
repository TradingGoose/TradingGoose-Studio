import { useCallback } from 'react'

interface NextAvailableSlotResponse {
  success: boolean
  data?: {
    nextAvailableSlot: string | null
    fieldType: string
    usedSlots: string[]
    totalSlots: number
    availableSlots: number
  }
  error?: string
}

export function useNextAvailableSlot(knowledgeBaseId: string | null) {
  const getNextAvailableSlot = useCallback(
    async (fieldType: string): Promise<string | null> => {
      if (!knowledgeBaseId) {
        throw new Error('Knowledge base ID is required')
      }

      const url = new URL(
        `/api/knowledge/${knowledgeBaseId}/next-available-slot`,
        window.location.origin
      )
      url.searchParams.set('fieldType', fieldType)

      const response = await fetch(url.toString())

      if (!response.ok) {
        throw new Error(`Failed to get next available slot: ${response.statusText}`)
      }

      const data: NextAvailableSlotResponse = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to get next available slot')
      }

      return data.data?.nextAvailableSlot || null
    },
    [knowledgeBaseId]
  )

  return { getNextAvailableSlot }
}
