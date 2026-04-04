import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { populateTriggerFieldsFromConfig } from '@/hooks/use-trigger-config-aggregation'
import {
  useWorkflowBlocks,
  useSubBlockValue,
} from '@/lib/yjs/use-workflow-doc'
import { getTrigger, isTriggerValid } from '@/triggers'
import { resolveTriggerIdForBlock } from '@/triggers/resolution'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useOptionalWorkflowSession } from '@/lib/yjs/workflow-session-host'
import {
  getWorkflowMap,
  getWorkflowTextFieldFromMap,
  getWorkflowTextFieldsMap,
  YJS_KEYS,
} from '@/lib/yjs/workflow-session'

const logger = createLogger('useWebhookManagement')

const CREDENTIAL_SET_PREFIX = 'credentialSet:'

interface UseWebhookManagementProps {
  blockId: string
  triggerId?: string
  useWebhookUrl?: boolean
}

interface WebhookManagementState {
  webhookUrl: string
  webhookPath: string
  webhookId: string | null
  isLoading: boolean
  isSaving: boolean
  saveConfig: () => Promise<boolean>
  deleteConfig: () => Promise<boolean>
}

function resolveEffectiveTriggerId(
  blockId: string,
  triggerId: string | undefined,
  blocks: Record<string, any>,
  webhook?: { providerConfig?: { triggerId?: string } },
): string | undefined {
  if (triggerId && isTriggerValid(triggerId)) {
    return triggerId
  }

  const block = blocks?.[blockId]

  // Read subblock values directly from the Yjs blocks
  const selectedTriggerId = block?.subBlocks?.selectedTriggerId?.value
  if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
    return selectedTriggerId
  }

  const storedTriggerId = block?.subBlocks?.triggerId?.value
  if (typeof storedTriggerId === 'string' && isTriggerValid(storedTriggerId)) {
    return storedTriggerId
  }

  if (webhook?.providerConfig?.triggerId && typeof webhook.providerConfig.triggerId === 'string') {
    return webhook.providerConfig.triggerId
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
  triggerId,
  useWebhookUrl = false,
}: UseWebhookManagementProps): WebhookManagementState {
  const workflowId = useOptionalWorkflowRoute()?.workflowId
  const workflowSession = useOptionalWorkflowSession()

  const triggerDef = triggerId && isTriggerValid(triggerId) ? getTrigger(triggerId) : null

  const blocks = useWorkflowBlocks()

  // Keep a ref to blocks so imperative callbacks always read fresh data
  // without needing blocks in their dependency arrays.
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks

  // Encapsulates the deep access + normalization for a block's trigger config.
  const getTriggerConfig = (targetBlockId: string): Record<string, unknown> => {
    const raw = blocksRef.current?.[targetBlockId]?.subBlocks?.triggerConfig?.value
    return typeof raw === 'object' && raw !== null
      ? (raw as unknown as Record<string, unknown>)
      : {}
  }

  const setSubBlockValue = useCallback(
    (targetBlockId: string, subBlockId: string, value: any) => {
      const doc = workflowSession?.doc
      if (!doc) {
        return
      }

      workflowSession.transactWorkflow((draftDoc) => {
        const textFields = getWorkflowTextFieldsMap(draftDoc)
        const sharedText = getWorkflowTextFieldFromMap(textFields, targetBlockId, subBlockId)
        if (sharedText) {
          const nextTextValue = typeof value === 'string' ? value : value == null ? '' : String(value)
          if (sharedText.toString() !== nextTextValue) {
            if (sharedText.length > 0) {
              sharedText.delete(0, sharedText.length)
            }
            if (nextTextValue) {
              sharedText.insert(0, nextTextValue)
            }
          }
        }

        const wMap = getWorkflowMap(draftDoc)
        const nextBlocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        const block = nextBlocks[targetBlockId]
        if (!block || sharedText) {
          return
        }

        const subBlocks = block.subBlocks ?? {}
        const existingSubBlock = subBlocks[subBlockId] ?? { id: subBlockId }
        nextBlocks[targetBlockId] = {
          ...block,
          subBlocks: {
            ...subBlocks,
            [subBlockId]: { ...existingSubBlock, value },
          },
        }
        wMap.set(YJS_KEYS.BLOCKS, nextBlocks)
      })
    },
    [workflowSession]
  )

  const batchSetSubBlockValues = useCallback(
    (updates: Array<{ blockId: string; subBlockId: string; value: any }>) => {
      const doc = workflowSession?.doc
      if (!doc) {
        return
      }

      workflowSession.transactWorkflow((draftDoc) => {
        const wMap = getWorkflowMap(draftDoc)
        const textFields = getWorkflowTextFieldsMap(draftDoc)
        const nextBlocks: Record<string, any> = { ...(wMap.get(YJS_KEYS.BLOCKS) ?? {}) }
        let changed = false

        for (const { blockId, subBlockId, value } of updates) {
          const block = nextBlocks[blockId]
          if (!block) {
            continue
          }

          const sharedText = getWorkflowTextFieldFromMap(textFields, blockId, subBlockId)
          if (sharedText) {
            const nextTextValue = typeof value === 'string' ? value : value == null ? '' : String(value)
            if (sharedText.toString() !== nextTextValue) {
              if (sharedText.length > 0) {
                sharedText.delete(0, sharedText.length)
              }
              if (nextTextValue) {
                sharedText.insert(0, nextTextValue)
              }
            }
            continue
          }

          const subBlocks = block.subBlocks ?? {}
          const existingSubBlock = subBlocks[subBlockId] ?? { id: subBlockId }
          nextBlocks[blockId] = {
            ...block,
            subBlocks: {
              ...subBlocks,
              [subBlockId]: { ...existingSubBlock, value },
            },
          }
          changed = true
        }

        if (changed) {
          wMap.set(YJS_KEYS.BLOCKS, nextBlocks)
        }
      })
    },
    [workflowSession]
  )

  // Read subblock values from Yjs blocks
  const webhookId = useSubBlockValue(blockId, 'webhookId') as string | null
  const webhookPath = useSubBlockValue(blockId, 'triggerPath') as string | null
  // Fine-grained subscription for the triggerId subblock value — avoids
  // re-running the sync effect on every unrelated Yjs mutation.
  const storedTriggerId = useSubBlockValue(blockId, 'triggerId') as string | null
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
    if (triggerId && storedTriggerId !== triggerId) {
      setSubBlockValue(blockId, 'triggerId', triggerId)
    }
  }, [triggerId, blockId, storedTriggerId, setSubBlockValue])

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
              const effectiveTriggerId = resolveEffectiveTriggerId(
                blockId,
                triggerId,
                blocksRef.current,
                webhook,
              )

              const {
                credentialId: _credId,
                credentialSetId: _credSetId,
                userId: _userId,
                historyId: _historyId,
                lastCheckedTimestamp: _lastChecked,
                setupCompleted: _setupCompleted,
                externalId: _externalId,
                triggerId: _triggerId,
                blockId: _blockId,
                ...userConfigurableFields
              } = webhook.providerConfig as Record<string, unknown>

              setSubBlockValue(blockId, 'triggerConfig', userConfigurableFields)

              if (effectiveTriggerId) {
                populateTriggerFieldsFromConfig(
                  blockId,
                  webhook.providerConfig,
                  effectiveTriggerId,
                  workflowId
                )
              } else {
                logger.warn('Cannot migrate - triggerId not available', {
                  blockId,
                  propTriggerId: triggerId,
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
  }, [triggerId, workflowId, blockId, useWebhookUrl])

  const createWebhook = async (
    effectiveTriggerId: string | undefined,
    selectedCredentialId: string | null
  ): Promise<boolean> => {
    if (!triggerDef || !effectiveTriggerId) {
      return false
    }

    const triggerConfig = getTriggerConfig(blockId)

    const isCredentialSet = selectedCredentialId?.startsWith(CREDENTIAL_SET_PREFIX)
    const credentialSetId = isCredentialSet
      ? selectedCredentialId!.slice(CREDENTIAL_SET_PREFIX.length)
      : undefined
    const credentialId = isCredentialSet ? undefined : selectedCredentialId

    const webhookConfig = {
      ...triggerConfig,
      ...(credentialId ? { credentialId } : {}),
      ...(credentialSetId ? { credentialSetId } : {}),
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
        provider: triggerDef.provider,
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

    batchSetSubBlockValues([
      { blockId, subBlockId: 'triggerPath', value: path },
      { blockId, subBlockId: 'triggerId', value: effectiveTriggerId },
      { blockId, subBlockId: 'webhookId', value: savedWebhookId },
    ])
    setIsChecked(true)

    logger.info('Trigger webhook created successfully', {
      webhookId: savedWebhookId,
      triggerId: effectiveTriggerId,
      provider: triggerDef.provider,
      blockId,
    })

    return true
  }

  const updateWebhook = async (
    webhookIdToUpdate: string,
    effectiveTriggerId: string | undefined,
    selectedCredentialId: string | null
  ): Promise<boolean> => {
    const triggerConfig = getTriggerConfig(blockId)

    const isCredentialSet = selectedCredentialId?.startsWith(CREDENTIAL_SET_PREFIX)
    const credentialSetId = isCredentialSet
      ? selectedCredentialId!.slice(CREDENTIAL_SET_PREFIX.length)
      : undefined
    const credentialId = isCredentialSet ? undefined : selectedCredentialId

    const response = await fetch(`/api/webhooks/${webhookIdToUpdate}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerConfig: {
          ...triggerConfig,
          ...(credentialId ? { credentialId } : {}),
          ...(credentialSetId ? { credentialSetId } : {}),
          triggerId: effectiveTriggerId,
        },
      }),
    })

    if (response.status === 404) {
      logger.warn('Webhook not found while updating, recreating', {
        blockId,
        lostWebhookId: webhookIdToUpdate,
      })
      setSubBlockValue(blockId, 'webhookId', null)
      return createWebhook(effectiveTriggerId, selectedCredentialId)
    }

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

    logger.info('Trigger config saved successfully', { blockId, webhookId: webhookIdToUpdate })
    return true
  }

  const saveConfig = async (): Promise<boolean> => {
    if (!triggerDef || !workflowId) {
      return false
    }

    const effectiveTriggerId = resolveEffectiveTriggerId(blockId, triggerId, blocksRef.current)

    try {
      setIsSaving(true)

      const triggerCredentials = blocksRef.current?.[blockId]?.subBlocks?.triggerCredentials?.value
      const selectedCredentialId = (triggerCredentials as string | null) || null

      if (!webhookId) {
        return createWebhook(effectiveTriggerId, selectedCredentialId)
      }

      return updateWebhook(webhookId, effectiveTriggerId, selectedCredentialId)
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
