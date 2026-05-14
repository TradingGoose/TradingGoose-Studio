'use client'

import { useEffect, useRef, useState } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import {
  type SlackChannelInfo,
  SlackChannelSelector,
} from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/channel-selector/components/slack-channel-selector'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useForeignCredential } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-foreign-credential'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWorkflowId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface ChannelSelectorInputProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  onChannelSelect?: (channelId: string) => void
  contextValues?: Record<string, any>
}

export function ChannelSelectorInput({
  blockId,
  subBlock,
  disabled = false,
  onChannelSelect,
  contextValues,
}: ChannelSelectorInputProps) {
  const workflowIdFromUrl = useWorkflowId()
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [connectedCredential] = useSubBlockValue(blockId, 'credential')

  const effectiveCredential = contextValues?.credential ?? connectedCredential
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [_channelInfo, setChannelInfo] = useState<SlackChannelInfo | null>(null)

  // Get provider-specific values
  const provider = subBlock.provider || 'slack'
  // Central dependsOn gating
  const { finalDisabled, dependsOn, dependencyValues } = useDependsOnGate(blockId, subBlock, {
    disabled,
  })

  const credential = (effectiveCredential as string) || ''

  const { isForeignCredential } = useForeignCredential('slack', credential)

  useEffect(() => {
    setSelectedChannelId(typeof storeValue === 'string' ? storeValue : '')
  }, [storeValue])

  // Clear channel when any declared dependency changes.
  const prevDepsSigRef = useRef<string>('')
  useEffect(() => {
    if (dependsOn.length === 0) return
    const currentSig = JSON.stringify(dependencyValues)
    if (prevDepsSigRef.current && prevDepsSigRef.current !== currentSig) {
      setSelectedChannelId('')
      setChannelInfo(null)
      setStoreValue('')
    }
    prevDepsSigRef.current = currentSig
  }, [dependsOn, dependencyValues, setStoreValue])

  // Handle channel selection (same pattern as file-selector)
  const handleChannelChange = (channelId: string, info?: SlackChannelInfo) => {
    setSelectedChannelId(channelId)
    setChannelInfo(info || null)
    setStoreValue(channelId)
    onChannelSelect?.(channelId)
  }

  if (provider !== 'slack') {
    return null
  }

  return (
    <div className='w-full'>
      <SlackChannelSelector
        value={selectedChannelId}
        onChange={(channelId: string, channelInfo?: SlackChannelInfo) => {
          handleChannelChange(channelId, channelInfo)
        }}
        credential={credential}
        label={subBlock.placeholder || 'Select Slack channel'}
        disabled={finalDisabled}
        workflowId={workflowIdFromUrl}
        isForeignCredential={isForeignCredential}
      />
    </div>
  )
}
