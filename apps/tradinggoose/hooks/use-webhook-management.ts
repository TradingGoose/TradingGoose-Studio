import { useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import {
  useSubBlockValue,
  useWorkflowBlocks,
  useWorkflowMutations,
} from '@/lib/yjs/use-workflow-doc'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import { getTrigger, isTriggerValid } from '@/triggers'
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

  // Read subblock values directly from the Yjs blocks
  const selectedTriggerId = block?.subBlocks?.selectedTriggerId?.value
  if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
    return selectedTriggerId
  }

  if (block) {
    const resolvedTriggerId = resolveTriggerIdForBlock(block)
    if (resolvedTriggerId && isTriggerValid(resolvedTriggerId)) {
      return resolvedTriggerId
    }
  }

  return undefined
}

export function useWebhookManagement({
  blockId,
  useWebhookUrl = false,
}: UseWebhookManagementProps): WebhookManagementState {
  const workflowId = useOptionalWorkflowRoute()?.workflowId
  const { setSubBlockValue, batchSetSubBlockValues } = useWorkflowMutations()
  const blocks = useWorkflowBlocks()

  // Keep a ref to blocks so imperative callbacks always read fresh data
  // without needing blocks in their dependency arrays.
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  // Read subblock values from Yjs blocks
  const webhookId = useSubBlockValue(blockId, 'webhookId') as string | null
  const webhookPath = useSubBlockValue(blockId, 'triggerPath') as string | null
  // Loading / checked state remains local UI state -- keep using a simple useState
  const [isLoading, setIsLoading] = useState(false)
  const [isChecked, setIsChecked] = useState(false)

  const webhookUrl = useMemo(() => {
    const baseUrl = getBaseUrl()
    if (!webhookPath) {
      return `${baseUrl}/api/webhooks/trigger/${blockId}`
    }
    return `${baseUrl}/api/webhooks/trigger/${webhookPath}`
  }, [webhookPath, blockId])

  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!workflowId) {
      return
    }

    const currentWebhookId = blocksRef.current?.[blockId]?.subBlocks?.webhookId?.value

    if (isLoading || (isChecked && currentWebhookId)) {
      return
    }

    const loadWebhookOrGenerateUrl = async () => {
      setIsLoading(true)

      try {
        const response = await fetch(`/api/webhooks?workflowId=${workflowId}&blockId=${blockId}`)

        if (response.ok) {
          const data = await response.json()

          if (data.webhooks && data.webhooks.length > 0) {
            const webhook = data.webhooks[0].webhook

            setSubBlockValue(blockId, 'webhookId', webhook.id)
            logger.info('Webhook loaded from API', {
              blockId,
              webhookId: webhook.id,
              hasProviderConfig: !!webhook.providerConfig,
            })

            if (webhook.path) {
              setSubBlockValue(blockId, 'triggerPath', webhook.path)
            }

            if (webhook.providerConfig) {
              const effectiveTriggerId = resolveEffectiveTriggerId(blockId, blocksRef.current)

              const {
                credentialId: _credId,
                userId: _userId,
                historyId: _historyId,
                lastCheckedTimestamp: _lastChecked,
                setupCompleted: _setupCompleted,
                externalId: _externalId,
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

    if (useWebhookUrl) {
      loadWebhookOrGenerateUrl()
    }
  }, [workflowId, blockId, useWebhookUrl, setSubBlockValue])

  const createWebhook = async (
    effectiveTriggerId: string | undefined,
    selectedCredentialId: string | null,
    triggerConfig: Record<string, unknown>
  ): Promise<boolean> => {
    const triggerDef = effectiveTriggerId ? getTrigger(effectiveTriggerId) : null
    if (!triggerDef || !effectiveTriggerId) {
      return false
    }

    const webhookConfig = {
      ...triggerConfig,
      ...(selectedCredentialId ? { credentialId: selectedCredentialId } : {}),
      triggerId: effectiveTriggerId,
    }

    const path = blockId

    const response = await fetch('/api/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId,
        blockId,
        path,
        provider: triggerDef.webhookProvider,
        providerConfig: webhookConfig,
      }),
    })

    if (!response.ok) {
      let errorMessage = 'Failed to create webhook'
      try {
        const errorData = await response.json()
        errorMessage = errorData.details || errorData.error || errorMessage
      } catch {
        // ignore
      }
      logger.error('Failed to create webhook', { errorMessage })
      throw new Error(errorMessage)
    }

    const data = await response.json()
    const savedWebhookId = data.webhook.id

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
      provider: triggerDef.webhookProvider,
      blockId,
    })

    return true
  }

  const updateWebhook = async (
    webhookIdToUpdate: string,
    effectiveTriggerId: string | undefined,
    selectedCredentialId: string | null,
    triggerConfig: Record<string, unknown>
  ): Promise<boolean> => {
    if (!effectiveTriggerId) {
      return false
    }

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
      let errorMessage = 'Failed to save trigger configuration'
      try {
        const errorData = await response.json()
        errorMessage = errorData.details || errorData.error || errorMessage
      } catch {
        // ignore
      }
      logger.error('Failed to save trigger config', { errorMessage })
      throw new Error(errorMessage)
    }

    setSubBlockValue(blockId, 'triggerConfig', { ...triggerConfig, triggerId: effectiveTriggerId })
    logger.info('Trigger config saved successfully', { blockId, webhookId: webhookIdToUpdate })
    return true
  }

  const saveConfig = async (triggerConfig: Record<string, unknown>): Promise<boolean> => {
    if (!workflowId) {
      return false
    }

    const effectiveTriggerId = resolveEffectiveTriggerId(blockId, blocksRef.current)
    if (!effectiveTriggerId) {
      return false
    }

    try {
      setIsSaving(true)

      const triggerCredentials = blocksRef.current?.[blockId]?.subBlocks?.triggerCredentials?.value
      const selectedCredentialId = (triggerCredentials as string | null) || null

      if (!webhookId) {
        return createWebhook(effectiveTriggerId, selectedCredentialId, triggerConfig)
      }

      return updateWebhook(webhookId, effectiveTriggerId, selectedCredentialId, triggerConfig)
    } catch (error) {
      logger.error('Error saving trigger config:', { error })
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const deleteConfig = async (): Promise<boolean> => {
    if (!webhookId) {
      return false
    }

    try {
      setIsSaving(true)

      const response = await fetch(`/api/webhooks/${webhookId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        logger.error('Failed to delete webhook')
        return false
      }

      batchSetSubBlockValues([
        { blockId, subBlockId: 'triggerPath', value: '' },
        { blockId, subBlockId: 'webhookId', value: null },
        { blockId, subBlockId: 'triggerConfig', value: null },
      ])
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
