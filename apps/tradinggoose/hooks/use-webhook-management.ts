import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import {
  useSubBlockValue,
  useWorkflowBlocks,
  useWorkflowMutations,
} from '@/lib/yjs/use-workflow-doc'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import { getTrigger } from '@/triggers'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('useWebhookManagement')

interface UseWebhookManagementProps {
  blockId: string
  useWebhookUrl?: boolean
}

interface WebhookManagementState {
  webhookUrl: string
  webhookPath: string
  webhookId: string | null
  isLoading: boolean
  isSaving: boolean
  saveConfig: (triggerConfig: Record<string, unknown>) => Promise<boolean>
  deleteConfig: () => Promise<boolean>
}

function resolveEffectiveTriggerId(
  blockId: string,
  blocks: Record<string, any>
): string | undefined {
  const block = blocks?.[blockId]
  return block ? (resolveTriggerIdForBlock(block) ?? undefined) : undefined
}

export function useWebhookManagement({
  blockId,
  useWebhookUrl = false,
}: UseWebhookManagementProps): WebhookManagementState {
  const workflowId = useOptionalWorkflowRoute()?.workflowId
  const { setSubBlockValue, batchSetSubBlockValues } = useWorkflowMutations()
  const blocks = useWorkflowBlocks()
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const persistedWebhookRef = useRef<{ path: string; provider: string | null } | undefined>(
    undefined
  )
  const webhookId = useSubBlockValue(blockId, 'webhookId') as string | null
  const webhookPath = useSubBlockValue(blockId, 'triggerPath') as string | null
  const [isLoading, setIsLoading] = useState(false)
  const [isChecked, setIsChecked] = useState(false)
  const webhookUrl = `${getBaseUrl()}/api/webhooks/trigger/${webhookPath || blockId}`
  const [isSaving, setIsSaving] = useState(false)
  useEffect(() => {
    if (!workflowId) return
    const currentWebhookId = blocksRef.current?.[blockId]?.subBlocks?.webhookId?.value
    if (isLoading || (isChecked && currentWebhookId)) return
    const loadWebhookOrGenerateUrl = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)
        if (response.ok) {
          const data = await response.json()
          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook
            persistedWebhookRef.current = {
              path: webhook.path,
              provider: webhook.provider ?? null,
            }
            setSubBlockValue(blockId, 'webhookId', webhook.id)
            logger.info('Webhook loaded from API', {
              blockId,
              webhookId: webhook.id,
              hasProviderConfig: !!webhook.providerConfig,
            })

            if (webhook.path) setSubBlockValue(blockId, 'triggerPath', webhook.path)
            if (webhook.providerConfig) {
              const effectiveTriggerId = resolveEffectiveTriggerId(blockId, blocksRef.current)
              const {
                credentialId: _credId,
                userId: _userId,
                historyId: _historyId,
                lastCheckedTimestamp: _lastChecked,
                setupCompleted: _setupCompleted,
                blockId: _blockId,
                ...savedTriggerConfig
              } = webhook.providerConfig as Record<string, unknown>
              setSubBlockValue(blockId, 'triggerConfig', savedTriggerConfig)
              if (effectiveTriggerId) {
                populateTriggerFieldsFromConfig(
                  blockId,
                  webhook.providerConfig,
                  effectiveTriggerId,
                  workflowId
                )
              } else {
                logger.warn('Cannot populate webhook config without selected trigger', {
                  blockId,
                  providerConfigTriggerId: webhook.providerConfig.triggerId,
                })
              }
            }
          } else {
            persistedWebhookRef.current = undefined
            setSubBlockValue(blockId, 'webhookId', null)
          }
          setIsChecked(true)
        } else {
          logger.warn('API response not OK', {
            blockId,
            workflowId,
            status: response.status,
            statusText: response.statusText,
          })
        }
      } catch (error) {
        logger.error('Error loading webhook:', { error, blockId, workflowId })
      } finally {
        setIsLoading(false)
      }
    }
    if (useWebhookUrl) void loadWebhookOrGenerateUrl()
  }, [workflowId, blockId, useWebhookUrl, setSubBlockValue])
  const createWebhook = async (
    effectiveTriggerId: string,
    provider: string,
    selectedCredentialId: string | null,
    triggerConfig: Record<string, unknown>
  ): Promise<boolean> => {
    const webhookConfig = {
      ...triggerConfig,
      ...(selectedCredentialId ? { credentialId: selectedCredentialId } : {}),
      triggerId: effectiveTriggerId,
    }
    const path = persistedWebhookRef.current?.path || webhookPath || blockId
    const response = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        blockId,
        path,
        provider,
        providerConfig: webhookConfig,
      }),
    })
    if (!response.ok) {
      let webhookCreateFailure = 'Failed to create webhook'
      try {
        const errorData = await response.json()
        webhookCreateFailure = errorData.details || errorData.error || webhookCreateFailure
      } catch {
        // ignore
      }
      logger.error('Failed to create webhook', { webhookCreateFailure })
      throw new Error(webhookCreateFailure)
    }
    const data = await response.json()
    const savedWebhookId = data.webhook.id
    persistedWebhookRef.current = {
      path: data.webhook.path ?? path,
      provider: data.webhook.provider ?? provider,
    }

    const savedTriggerConfig = { ...triggerConfig, triggerId: effectiveTriggerId }
    batchSetSubBlockValues([
      { blockId, subBlockId: 'triggerPath', value: path },
      { blockId, subBlockId: 'webhookId', value: savedWebhookId },
      { blockId, subBlockId: 'triggerConfig', value: savedTriggerConfig },
    ])
    setIsChecked(true)
    logger.info('Trigger webhook created successfully', {
      webhookId: savedWebhookId,
      triggerId: effectiveTriggerId,
      provider,
      blockId,
    })
    return true
  }
  const updateWebhook = async (
    webhookIdToUpdate: string,
    effectiveTriggerId: string,
    selectedCredentialId: string | null,
    triggerConfig: Record<string, unknown>
  ): Promise<boolean> => {
    const response = await fetch(`/api/webhooks/${webhookIdToUpdate}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerConfig: {
          ...triggerConfig,
          ...(selectedCredentialId ? { credentialId: selectedCredentialId } : {}),
          triggerId: effectiveTriggerId,
        },
      }),
    })
    if (!response.ok) {
      let webhookUpdateFailure = 'Failed to save trigger configuration'
      try {
        const errorData = await response.json()
        webhookUpdateFailure = errorData.details || errorData.error || webhookUpdateFailure
      } catch {
        // ignore
      }
      logger.error('Failed to save trigger config', { webhookUpdateFailure })
      throw new Error(webhookUpdateFailure)
    }
    setSubBlockValue(blockId, 'triggerConfig', { ...triggerConfig, triggerId: effectiveTriggerId })
    logger.info('Trigger config saved successfully', { blockId, webhookId: webhookIdToUpdate })
    return true
  }
  const saveConfig = async (triggerConfig: Record<string, unknown>): Promise<boolean> => {
    if (!workflowId) return false
    const effectiveTriggerId = resolveEffectiveTriggerId(blockId, blocksRef.current)
    if (!effectiveTriggerId) return false
    const triggerDef = getTrigger(effectiveTriggerId)
    if (!triggerDef) return false
    setIsSaving(true)
    try {
      const triggerCredentials = blocksRef.current?.[blockId]?.subBlocks?.triggerCredentials?.value
      const selectedCredentialId = (triggerCredentials as string | null) || null
      const provider = triggerDef.webhookProvider
      if (!webhookId || persistedWebhookRef.current?.provider == null || provider === 'airtable') {
        return createWebhook(effectiveTriggerId, provider, selectedCredentialId, triggerConfig)
      }
      if (persistedWebhookRef.current.provider !== provider) return false
      return updateWebhook(webhookId, effectiveTriggerId, selectedCredentialId, triggerConfig)
    } finally {
      setIsSaving(false)
    }
  }
  const deleteConfig = async (): Promise<boolean> => {
    if (!webhookId) return false
    setIsSaving(true)
    try {
      const response = await fetch(`/api/webhooks/${webhookId}`, { method: 'DELETE' })
      if (!response.ok) {
        logger.error('Failed to delete webhook')
        return false
      }
      batchSetSubBlockValues([
        { blockId, subBlockId: 'triggerPath', value: '' },
        { blockId, subBlockId: 'webhookId', value: null },
        { blockId, subBlockId: 'triggerConfig', value: null },
      ])
      persistedWebhookRef.current = undefined
      setIsChecked(false)
      logger.info('Webhook deleted successfully')
      return true
    } catch (error) {
      logger.error('Error deleting webhook:', { error })
      return false
    } finally {
      setIsSaving(false)
    }
  }
  return {
    webhookUrl,
    webhookPath: webhookPath || blockId,
    webhookId,
    isLoading,
    isSaving,
    saveConfig,
    deleteConfig,
  }
}
